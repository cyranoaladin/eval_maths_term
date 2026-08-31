/**
 * L'ordre d'un arrêt.
 *
 * Rien n'écoutait SIGTERM : un redéploiement ou un arrêt de machine coupait le
 * processus au milieu de ce qu'il faisait. Une remise de copie interrompue
 * entre l'écriture des réponses et celle du total laisse une copie à moitié
 * corrigée.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const arretDuBalayage = vi.fn();
const fermetureDuPool = vi.fn().mockResolvedValue(undefined);

vi.mock("../../anticheat/idle-scheduler", () => ({
  arreterBalayageInactivite: () => arretDuBalayage(),
}));
vi.mock("../../queries/connection", () => ({
  fermerPool: () => fermetureDuPool(),
}));
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * Le module retient qu'un arrêt a commencé — c'est justement ce qu'on veut : un
 * second signal ne doit pas relancer la séquence. Chaque test part donc d'une
 * instance neuve plutôt que d'une porte dérobée réservée aux tests.
 */
async function moduleNeuf() {
  vi.resetModules();
  return import("../arret-gracieux");
}

beforeEach(() => {
  arretDuBalayage.mockClear();
  fermetureDuPool.mockClear();
});

/** Un serveur qui met `retardMs` à rendre la main sur `close`. */
function serveurQuiFerme(retardMs: number) {
  const appels: string[] = [];
  return {
    appels,
    close(rappel?: () => void) {
      appels.push("close");
      setTimeout(() => rappel?.(), retardMs);
    },
  };
}

describe("arrêt gracieux", () => {
  it("signale l'arrêt en cours à la sonde de disponibilité", async () => {
    const { arreter, arretDemande } = await moduleNeuf();
    expect(arretDemande()).toBe(false);
    const attente = arreter(serveurQuiFerme(10), 5_000);
    expect(arretDemande()).toBe(true);
    await attente;
  });

  it("cesse d'accepter, laisse finir, puis rend les connexions", async () => {
    const { arreter } = await moduleNeuf();
    const serveur = serveurQuiFerme(10);
    await arreter(serveur, 5_000);

    expect(arretDuBalayage).toHaveBeenCalledOnce();
    expect(serveur.appels).toEqual(["close"]);
    expect(fermetureDuPool).toHaveBeenCalledOnce();
  });

  it("n'attend pas indéfiniment une requête qui ne finit pas", async () => {
    // Un arrêt qui ne se termine jamais sera tué de force, sans rien rendre.
    const { arreter } = await moduleNeuf();
    const serveur = serveurQuiFerme(60_000);
    const depart = Date.now();
    await arreter(serveur, 150);
    expect(Date.now() - depart).toBeLessThan(2_000);
    expect(fermetureDuPool).toHaveBeenCalledOnce();
  });

  it("ferme les connexions inactives sans attendre leur délai de garde", async () => {
    /*
      `server.close()` attend que **toutes** les connexions se ferment, y
      compris celles qui ne portent aucune requête et que le client garde
      ouvertes pour la suivante. Le délai de garde du serveur a été porté à
      125 secondes — au-delà des 115 du client le plus patient — et une
      connexion inactive retenait donc l'arrêt bien après les vingt secondes
      accordées.

      `closeIdleConnections()` ferme celles-là, et celles-là seulement : une
      requête en cours va toujours à son terme. Vu en vrai sur le smoke d'arrêt
      gracieux, qui a commencé à signaler « des requêtes n'ont pas fini » alors
      que la copie, elle, était bien complète.
    */
    const { arreter } = await moduleNeuf();
    const appels: string[] = [];
    let rappelFermeture: (() => void) | undefined;

    /*
      Le point délicat : au moment du signal, la connexion qui porte la remise
      n'est pas inactive. Elle le devient une fois la réponse partie. Un seul
      appel, fait trop tôt, ne la voit pas — c'est ce qui restait en échec
      après un premier correctif.
    */
    let requeteEnVol = true;
    const serveur = {
      close(rappel?: () => void) {
        appels.push("close");
        rappelFermeture = rappel;
      },
      closeIdleConnections() {
        appels.push("closeIdleConnections");
        // Tant que la requête vole, il n'y a rien d'inactif à relâcher.
        if (!requeteEnVol) rappelFermeture?.();
      },
    };

    const fin = arreter(serveur, 2_000);
    // La remise aboutit après le premier passage : la connexion devient inactive.
    await new Promise((r) => setTimeout(r, 250));
    requeteEnVol = false;

    await fin;

    expect(appels[0]).toBe("close");
    expect(appels.filter((a) => a === "closeIdleConnections").length).toBeGreaterThan(1);
  });

  it("s'accommode d'un serveur qui ne sait pas fermer ses connexions inactives", async () => {
    // HTTP/2 et les serveurs de test n'exposent pas toujours cette méthode.
    const { arreter } = await moduleNeuf();
    const serveur = serveurQuiFerme(5);

    await expect(arreter(serveur, 1_000)).resolves.toBeUndefined();
    expect(serveur.appels).toEqual(["close"]);
  });

  it("ne s'exécute qu'une fois, même si le signal se répète", async () => {
    const { arreter } = await moduleNeuf();
    const serveur = serveurQuiFerme(5);
    await Promise.all([arreter(serveur, 500), arreter(serveur, 500)]);
    expect(fermetureDuPool).toHaveBeenCalledOnce();
  });
});

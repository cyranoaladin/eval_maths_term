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

  it("ne s'exécute qu'une fois, même si le signal se répète", async () => {
    const { arreter } = await moduleNeuf();
    const serveur = serveurQuiFerme(5);
    await Promise.all([arreter(serveur, 500), arreter(serveur, 500)]);
    expect(fermetureDuPool).toHaveBeenCalledOnce();
  });
});

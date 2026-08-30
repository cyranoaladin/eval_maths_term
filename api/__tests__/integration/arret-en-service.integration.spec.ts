/**
 * Ce que répond un serveur qu'on est en train d'arrêter.
 *
 * Un redéploiement ne doit pas couper une remise de copie en deux. Le serveur
 * commence donc par se retirer de la rotation — il répond « pas prêt » au
 * répartiteur — puis laisse les échanges en cours aller à leur terme avant de
 * rendre ses connexions.
 *
 * Ce cas vit seul dans son fichier : l'arrêt est sans retour pour le module qui
 * le porte, et il ferme le pool. Ce qui suivrait n'aurait plus de base.
 */
import { describe, it, expect } from "vitest";
import application from "../../boot";
import { arreter, arretDemande } from "../../lib/arret-gracieux";

describe("pendant un arrêt", () => {
  it("se retire de la rotation, puis ferme", async () => {
    expect(arretDemande()).toBe(false);

    // Un serveur de théâtre : ce qu'on éprouve est la réponse donnée au
    // répartiteur, pas la fermeture d'une écoute réseau.
    let ferme = false;
    await arreter(
      {
        close: (rappel) => {
          ferme = true;
          rappel?.();
        },
      },
      1_000,
    );

    expect(ferme).toBe(true);
    expect(arretDemande()).toBe(true);

    const pret = await application.request("http://atelier.test/api/ready");
    expect(pret.status).toBe(503);
    await expect(pret.json()).resolves.toMatchObject({
      pret: false,
      raison: "arrêt en cours",
    });

    // La vivacité répond encore : le processus n'est pas mort, et un
    // orchestrateur n'a aucune raison de le tuer pendant qu'il termine.
    expect((await application.request("http://atelier.test/api/health")).status).toBe(200);
  });

  it("ne recommence pas un arrêt déjà en cours", async () => {
    let appels = 0;
    await arreter({ close: (rappel) => { appels += 1; rappel?.(); } });
    expect(appels).toBe(0);
  });
});

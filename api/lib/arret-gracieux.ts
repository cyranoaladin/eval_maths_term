/**
 * api/lib/arret-gracieux.ts
 *
 * Ce qui se passe quand on demande au serveur de s'arrêter.
 *
 * Rien ne l'écoutait : un `docker compose down`, un redéploiement, un
 * redémarrage de machine coupaient le processus au milieu de ce qu'il faisait.
 * Une remise de copie interrompue entre l'écriture des réponses et celle du
 * total laisse une copie à moitié corrigée — et c'est le moment où le risque
 * est le plus élevé, puisqu'on redéploie rarement pendant une épreuve mais
 * qu'une machine, elle, ne choisit pas son heure.
 *
 * L'ordre compte : on cesse d'accepter, on laisse finir, puis on rend les
 * ressources. Passé un délai, on s'arrête quand même — un arrêt qui ne finit
 * jamais est un arrêt qui sera tué de force, sans rien rendre du tout.
 */
import { logger } from "./logger";
import { arreterBalayageInactivite } from "../anticheat/idle-scheduler";
import { fermerPool } from "../queries/connection";

/**
 * Au-delà, on considère qu'une requête ne finira pas. Une remise de copie tient
 * largement dedans ; un téléchargement de PDF aussi.
 */
export const DELAI_ARRET_MS = 20_000;

let arretEnCours = false;

/** Vrai dès qu'un arrêt a été demandé : la disponibilité doit le refléter. */
export function arretDemande(): boolean {
  return arretEnCours;
}

/**
 * Le minimum qu'on attend d'un serveur pour l'arrêter : cesser d'accepter, et
 * prévenir quand les échanges en cours sont terminés. HTTP/1 et HTTP/2
 * l'exposent différemment ; seule cette forme commune nous intéresse.
 */
export interface ServeurArretable {
  close(rappel?: (erreur?: Error) => void): unknown;
}

export async function arreter(
  serveur: ServeurArretable,
  delaiMs: number = DELAI_ARRET_MS,
): Promise<void> {
  if (arretEnCours) return;
  arretEnCours = true;

  logger.info("Arrêt demandé : le serveur cesse d'accepter de nouvelles requêtes");

  // 1. Le balayage d'inactivité ne doit pas ouvrir de nouveau travail.
  arreterBalayageInactivite();

  // 2. Plus de nouvelles connexions ; celles en cours vont à leur terme.
  const fermeture = new Promise<void>((resoudre) => {
    serveur.close(() => resoudre());
  });

  let expire = false;
  const echeance = new Promise<void>((resoudre) => {
    const minuteur = setTimeout(() => {
      expire = true;
      resoudre();
    }, delaiMs);
    minuteur.unref?.();
  });

  await Promise.race([fermeture, echeance]);

  if (expire) {
    logger.warn("Des requêtes n'ont pas fini dans le délai imparti", { delaiMs });
  } else {
    logger.info("Toutes les requêtes en cours sont terminées");
  }

  // 3. Rendre les connexions à la base plutôt que les laisser couper.
  await fermerPool();
  logger.info("Arrêt terminé");
}

/** Branche SIGTERM et SIGINT. Idempotent. */
export function installerArretGracieux(serveur: ServeurArretable): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void arreter(serveur).then(() => process.exit(0));
    });
  }
}

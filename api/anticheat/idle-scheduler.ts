/**
 * api/anticheat/idle-scheduler.ts
 *
 * Déclencheur périodique du balayage d'inactivité.
 *
 * Le balayage lui-même reste une fonction pure, sans minuterie : c'est ce qui
 * le rend testable. Mais il n'était appelé que par l'arrivée d'un heartbeat
 * d'un *autre* élève ou par l'ouverture du tableau de bord enseignant. Une
 * copie abandonnée en fin d'épreuve — quand plus personne n'émet — n'était donc
 * jamais remise automatiquement, et la session restait `in_progress`
 * indéfiniment. Le seuil des 180 secondes ne tenait que par accident.
 *
 * L'intervalle est court devant les seuils métier (60 s / 180 s) : la détection
 * reste franche sans que le balayage devienne coûteux.
 */
import { runIdleSweep } from "./idle-sweeper";
import { logger } from "../lib/logger";

export const INTERVALLE_BALAYAGE_MS = 30_000;

let minuterie: ReturnType<typeof setInterval> | null = null;

/** Démarre le balayage périodique. Idempotent. */
export function demarrerBalayageInactivite(
  intervalleMs: number = INTERVALLE_BALAYAGE_MS,
): void {
  if (minuterie) return;
  minuterie = setInterval(() => {
    runIdleSweep().catch((err) => {
      logger.error("Balayage d'inactivité en échec", { err });
    });
  }, intervalleMs);
  // Ne retient pas le processus : un serveur qui s'arrête ne doit pas attendre
  // la prochaine échéance.
  minuterie.unref?.();
  logger.info("Balayage d'inactivité démarré", { intervalleMs });
}

/** Arrête le balayage périodique. Idempotent. */
export function arreterBalayageInactivite(): void {
  if (!minuterie) return;
  clearInterval(minuterie);
  minuterie = null;
}

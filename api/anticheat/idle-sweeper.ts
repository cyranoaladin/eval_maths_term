/**
 * api/anticheat/idle-sweeper.ts
 *
 * Balayage périodique des sessions actives sans heartbeat récent.
 * - À 60 s sans heartbeat : log WARNING (pas encore d'action).
 * - À 180 s sans heartbeat : auto-submit de la session.
 *
 * Usage : appelé par le router heartbeat (sur chaque heartbeat reçu)
 * et par un setInterval côté serveur si besoin.
 * Le sweeper est simple et synchrone ; il ne tourne PAS en boucle par lui-même
 * pour rester testable et éviter les faux-positifs en dev.
 */
import { lt, eq, and, isNotNull, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { sessions } from "@db/schema";
import { autoSubmitSession } from "./auto-submit";
import { AUTO_SUBMIT_THRESHOLD_MS, IDLE_THRESHOLD_MS } from "@contracts/anticheat-config";
import { logger } from "../lib/logger";

export interface SweepResult {
  checked: number;
  warned: number;
  autoSubmitted: number;
  errors: number;
}

/**
 * Parcourt toutes les sessions `in_progress` avec un heartbeat connu
 * et déclenche l'action appropriée selon l'âge du dernier heartbeat.
 */
export async function runIdleSweep(): Promise<SweepResult> {
  const db = getDb();
  const now = Date.now();
  const warnSince = new Date(now - IDLE_THRESHOLD_MS);
  const autoSince = new Date(now - AUTO_SUBMIT_THRESHOLD_MS);

  // Sélectionner les sessions candidates (lastHeartbeatAt non null + in_progress)
  const candidates = await db
    .select({
      id: sessions.id,
      lastHeartbeatAt: sessions.lastHeartbeatAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.status, "in_progress"),
        isNotNull(sessions.lastHeartbeatAt),
        lt(sessions.lastHeartbeatAt, warnSince),
      ),
    );

  let warned = 0;
  let autoSubmitted = 0;
  let errors = 0;

  for (const s of candidates) {
    const hbAt = s.lastHeartbeatAt!;
    const idleMs = now - new Date(hbAt).getTime();

    if (idleMs >= AUTO_SUBMIT_THRESHOLD_MS) {
      // Auto-submit
      try {
        await autoSubmitSession(s.id, { reason: "idle_disconnect" });
        autoSubmitted++;
        logger.warn("Session auto-submitted par idle-sweeper", {
          sessionId: s.id,
          idleMs,
        });
      } catch (err) {
        errors++;
        logger.error("Erreur auto-submit idle-sweeper", {
          sessionId: s.id,
          err,
        });
      }
    } else {
      // Juste un warning (entre 60s et 180s)
      warned++;
      logger.warn("Session idle détectée", {
        sessionId: s.id,
        idleSec: Math.floor(idleMs / 1000),
      });
    }
  }

  return {
    checked: candidates.length,
    warned,
    autoSubmitted,
    errors,
  };
}

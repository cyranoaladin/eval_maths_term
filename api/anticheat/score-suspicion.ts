/**
 * api/anticheat/score-suspicion.ts
 *
 * Calcul du score de suspicion (0–100) et verdict pédagogique.
 * Les pondérations sont externalisées dans contracts/anticheat-config.ts.
 */
import { eq } from "drizzle-orm";
import { EVENT_WEIGHTS, VERDICT_THRESHOLDS } from "@contracts/anticheat-config";
import { cheatEvents } from "@db/schema";
import type { Executeur } from "../queries/connection";
import type { CheatEventType } from "@db/schema";

type SuspicionVerdict = "clean" | "minor" | "moderate" | "severe";

export interface SuspicionResult {
  score: number;
  verdict: SuspicionVerdict;
  reasons: Array<{
    type: CheatEventType;
    count: number;
    contribution: number;
  }>;
}

/**
 * Calcule le score de suspicion à partir d'une liste d'événements.
 * Les événements peuvent être coalescés (count > 1) ou individuels (count omis = 1).
 */
export function computeSuspicionScore(
  events: Array<{ type: CheatEventType; count?: number }>,
): SuspicionResult {
  // Agréger les counts par type
  const counts = new Map<CheatEventType, number>();
  for (const e of events) {
    counts.set(e.type, (counts.get(e.type) ?? 0) + (e.count ?? 1));
  }

  const reasons: SuspicionResult["reasons"] = [];
  let total = 0;

  for (const [type, count] of counts) {
    const w = EVENT_WEIGHTS[type];
    if (!w) continue;
    const contribution = Math.min(w.cap, count * w.unit);
    if (contribution > 0) {
      reasons.push({ type, count, contribution });
      total += contribution;
    }
  }

  const score = Math.min(100, Math.round(total));

  const verdict: SuspicionVerdict =
    score >= VERDICT_THRESHOLDS.severe   ? "severe"   :
    score >= VERDICT_THRESHOLDS.moderate ? "moderate" :
    score >= VERDICT_THRESHOLDS.minor    ? "minor"    :
                                           "clean";

  return { score, verdict, reasons };
}

/**
 * Score de suspicion d'une copie, lu depuis le journal des incidents.
 *
 * La remise volontaire et la remise automatique lisaient chacune la table et
 * refaisaient la même agrégation — mêmes lignes, même conversion du champ
 * `metadata.count`, deux endroits où se tromper. Le score qui décide du verdict
 * d'une copie n'a qu'une façon d'être calculé.
 *
 * `executeur` accepte une transaction : la remise automatique calcule dans la
 * même transaction que l'écriture des réponses.
 */
export async function suspicionDeLaSession(
  sessionId: number,
  executeur: Executeur,
): Promise<SuspicionResult> {
  const incidents = await executeur
    .select({ type: cheatEvents.type, metadata: cheatEvents.metadata })
    .from(cheatEvents)
    .where(eq(cheatEvents.sessionId, sessionId));

  return computeSuspicionScore(
    incidents.map((i) => ({
      type: i.type,
      count: (i.metadata as { count?: number } | null)?.count ?? 1,
    })),
  );
}

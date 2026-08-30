/**
 * api/grading/grade-audit.ts
 *
 * Écriture du journal des interventions sur les notes.
 *
 * La responsabilité est **serveur** : le frontend ne décide pas de ce qui est
 * tracé ni de ce qu'il déclare avoir fait. Toute route qui touche une note
 * appelle ce module dans la même transaction logique que la modification.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { gradeAudit, responses } from "@db/schema";
import { currentRequestId } from "../lib/request-id";
import { toDecimal } from "../lib/decimal";
import { logger } from "../lib/logger";

type AuditAction = "manual_override" | "manual_paper" | "regrade";

export interface AuditEntry {
  sessionId: number;
  responseId?: number | null;
  questionId?: number | null;
  actorId?: number | null;
  actorEmail?: string | null;
  action: AuditAction;
  oldScore?: number | null;
  newScore?: number | null;
  oldMode?: string | null;
  newMode?: string | null;
  reason?: string | null;
}

/** Consigne une intervention. N'échoue jamais la modification qu'elle trace. */
export async function recordGradeAudit(entry: AuditEntry): Promise<void> {
  const db = getDb();
  try {
    await db.insert(gradeAudit).values({
      sessionId: entry.sessionId,
      responseId: entry.responseId ?? null,
      questionId: entry.questionId ?? null,
      actorId: entry.actorId ?? null,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      oldScore: entry.oldScore != null ? toDecimal(entry.oldScore) : null,
      newScore: entry.newScore != null ? toDecimal(entry.newScore) : null,
      oldMode: entry.oldMode ?? null,
      newMode: entry.newMode ?? null,
      reason: entry.reason ?? null,
      requestId: currentRequestId() ?? null,
    });
  } catch (e) {
    // Perdre une ligne de journal ne doit pas faire échouer une correction déjà
    // appliquée — mais l'incident doit être visible.
    logger.error("[audit] Écriture du journal impossible", {
      sessionId: entry.sessionId,
      action: entry.action,
      error: String(e).slice(0, 200),
    });
  }
}

/** État d'une réponse avant modification, pour renseigner l'ancienne valeur. */
export async function readResponseState(responseId: number) {
  const db = getDb();
  const [row] = await db
    .select({
      id: responses.id,
      sessionId: responses.sessionId,
      questionId: responses.questionId,
      score: responses.score,
      gradingMode: responses.gradingMode,
    })
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);
  return row ?? null;
}

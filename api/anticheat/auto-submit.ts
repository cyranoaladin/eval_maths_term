/**
 * api/anticheat/auto-submit.ts
 *
 * Pipeline : brouillons (answer_drafts) → responses → correction → status final.
 *
 * Règles :
 * - Idempotent : si la session n'est plus in_progress, retour immédiat.
 * - skipLLM=true : pas d'appel LLM synchrone (latence inacceptable).
 *   Les questions nécessitant le LLM sont marquées needsLLM=true dans responses.llmFeedback.
 * - Transaction SQL : cohérence garantie même si le process crashe.
 * - normalizedScore = round(totalScore/maxScore*20*4)/4 → sur 20 avec précision 0,25.
 */
import { eq, and, isNull } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  sessions,
  responses,
  answerDrafts,
  cheatEvents,
  questions,
} from "@db/schema";
import { gradeResponse } from "../grading/grade-response";
import { computeSuspicionScore } from "./score-suspicion";
import { GradingRubricSchema } from "../../contracts/grading-rubric";
import { logger } from "../lib/logger";
import type { CheatEventType } from "@db/schema";

export type AutoSubmitReason =
  | "idle_disconnect"
  | "manual_force"
  | "time_expired";

export interface AutoSubmitOptions {
  reason: AutoSubmitReason;
}

/**
 * Soumet automatiquement une session en transformant ses brouillons en réponses.
 * Idempotent — sans danger à appeler plusieurs fois.
 */
export async function autoSubmitSession(
  sessionId: number,
  opts: AutoSubmitOptions,
): Promise<void> {
  const db = getDb();

  await db.transaction(async (tx) => {
    // 1. Vérifier la session
    const [session] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session) throw new Error(`Session ${sessionId} introuvable`);
    if (session.status !== "in_progress") return; // idempotent

    // 2. Récupérer les drafts non-committés
    const drafts = await tx
      .select()
      .from(answerDrafts)
      .where(
        and(
          eq(answerDrafts.sessionId, sessionId),
          isNull(answerDrafts.committedAt),
        ),
      );

    // 3. Récupérer toutes les questions de l'évaluation
    const qs = await tx
      .select()
      .from(questions)
      .where(eq(questions.evaluationId, session.evaluationId));

    const qMap = new Map(qs.map((q) => [q.id, q]));
    const realMaxScore = qs.reduce((sum, q) => sum + q.points, 0);

    let totalScore = 0;

    // 4. Convertir chaque draft en response
    for (const draft of drafts) {
      const q = qMap.get(draft.questionId);
      if (!q) continue;

      // Parser la rubric
      const rubricRaw = q.gradingRubric;
      let result;

      if (!rubricRaw) {
        result = {
          score: 0,
          maxPoints: q.points,
          isCorrect: false,
          feedback: "Rubric manquante — à corriger manuellement.",
          gradingMode: "missing_rubric",
          llmConfidence: null,
          partialCreditApplied: false,
          needsLLM: false,
        };
      } else {
        const rubricParsed = GradingRubricSchema.safeParse(rubricRaw);
        if (!rubricParsed.success) {
          result = {
            score: 0,
            maxPoints: q.points,
            isCorrect: false,
            feedback: "Rubric invalide — à corriger manuellement.",
            gradingMode: "invalid_rubric",
            llmConfidence: null,
            partialCreditApplied: false,
            needsLLM: false,
          };
        } else {
          result = await gradeResponse({
            questionType: q.type,
            studentAnswer: draft.answer ?? "",
            justification: draft.justification ?? undefined,
            rubric: rubricParsed.data,
            questionText: q.question,
            maxPoints: q.points,
            skipLLM: true,
          });
        }
      }

      // Insérer la response
      await tx.insert(responses).values({
        sessionId,
        questionId: draft.questionId,
        answer: draft.answer ?? "",
        justification: draft.justification,
        isCorrect: result.isCorrect,
        score: result.score,
        maxScore: q.points,
        llmFeedback: result.needsLLM
          ? "À corriger manuellement par l'enseignant."
          : result.feedback,
        gradingMode: result.gradingMode,
        gradedAt: new Date(),
        partialCreditApplied: result.partialCreditApplied,
      });

      // Archiver le draft
      await tx
        .update(answerDrafts)
        .set({ committedAt: new Date() })
        .where(
          and(
            eq(answerDrafts.sessionId, sessionId),
            eq(answerDrafts.questionId, draft.questionId),
          ),
        );

      totalScore += result.score;
    }

    // 5. Calculer le score de suspicion final
    const events = await tx
      .select()
      .from(cheatEvents)
      .where(eq(cheatEvents.sessionId, sessionId));

    const suspicion = computeSuspicionScore(
      events.map((e) => ({
        type: e.type as CheatEventType,
        count: (e.metadata as { count?: number })?.count ?? 1,
      })),
    );

    // 6. Enregistrer idle_disconnect si applicable
    if (opts.reason === "idle_disconnect") {
      await tx.insert(cheatEvents).values({
        sessionId,
        type: "idle_disconnect",
        timestamp: new Date(),
        metadata: { count: 1 },
      });
    }

    // 7. Calcul du score normalisé /20 (arrondi au quart de point)
    const normalizedScore =
      realMaxScore > 0
        ? Math.round((totalScore / realMaxScore) * 20 * 4) / 4
        : 0;

    // 8. Marquer la session
    await tx
      .update(sessions)
      .set({
        status: "auto_submitted_idle",
        endedAt: new Date(),
        totalScore,
        maxScore: realMaxScore,
        normalizedScore: normalizedScore.toFixed(2),
        suspicionScore: suspicion.score,
        suspicionVerdict: suspicion.verdict,
        timeSpent: session.startedAt
          ? Math.floor(
              (Date.now() - new Date(session.startedAt).getTime()) / 1000,
            )
          : null,
      })
      .where(eq(sessions.id, sessionId));

    logger.info("Session auto-submitted", {
      sessionId,
      reason: opts.reason,
      totalScore,
      maxScore: realMaxScore,
      normalizedScore,
      suspicionScore: suspicion.score,
    });
  });
}

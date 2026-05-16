/**
 * api/routers/grading-router.ts — Phase 2
 *
 * Remplace api/grading-router.ts (ancien, basé sur authedQuery + prompt naïf).
 * Ce router utilise le moteur de correction Phase 2 (grade-response.ts).
 *
 * Routes :
 *   - gradeSession (teacherQuery) : corrige toutes les réponses d'une session
 *   - getResults (teacherQuery) : résultats d'une session avec détail par question
 *   - overrideGrade (teacherQuery) : correction manuelle par l'enseignant
 *
 * Sécurité :
 *   - gradingRubric lue depuis la DB côté serveur, jamais transmise au client
 *   - correctAnswer jamais renvoyée au client
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, teacherQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { responses, sessions, questions } from "@db/schema";
import { eq } from "drizzle-orm";
import { gradeResponse } from "../grading/grade-response";
import { resolveOriginalIndex, shuffleDeterministic } from "../grading/shuffle";
import { GradingRubricSchema } from "../../contracts/grading-rubric";
import { logger } from "../lib/logger";

export const gradingRouter2 = createRouter({
  /**
   * Corrige toutes les réponses d'une session.
   * Utilise le moteur Phase 2 : exact → numeric → symbolic → fraction → set → LLM.
   * Idempotent : re-corriger une session met à jour les scores existants.
   */
  gradeSession: teacherQuery
    .input(z.object({ sessionId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { sessionId } = input;

      // Vérifier que la session existe
      const [session] = await db
        .select({
          id: sessions.id,
          evaluationId: sessions.evaluationId,
          shuffleSeed: sessions.shuffleSeed,
          status: sessions.status,
        })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session introuvable" });
      }

      // Récupérer toutes les réponses de la session
      const resps = await db
        .select()
        .from(responses)
        .where(eq(responses.sessionId, sessionId));

      // Récupérer toutes les questions (avec gradingRubric et correctAnswer)
      const qs = await db
        .select()
        .from(questions)
        .where(eq(questions.evaluationId, session.evaluationId));

      const questionMap = new Map(qs.map((q) => [q.id, q]));

      let totalScore = 0;
      let totalMax = 0;
      let gradedCount = 0;

      for (const resp of resps) {
        const q = questionMap.get(resp.questionId);
        if (!q) continue;

        totalMax += q.points;

        // Parser la gradingRubric (stockée en JSON dans la DB)
        const rubricRaw = q.gradingRubric;
        if (!rubricRaw) {
          logger.warn("Question sans rubric — ignorée", { questionId: q.id });
          totalScore += resp.score ?? 0;
          continue;
        }

        const rubricParsed = GradingRubricSchema.safeParse(rubricRaw);
        if (!rubricParsed.success) {
          logger.warn("Rubric invalide — correction skippée", {
            questionId: q.id,
            error: rubricParsed.error.message,
          });
          totalScore += resp.score ?? 0;
          continue;
        }
        const rubric = rubricParsed.data;

        // Pour les QCM : résoudre l'index soumis via le mapping de mélange
        let resolvedQcmIndex: number | undefined;
        if (q.type === "qcm" && session.shuffleSeed) {
          const options = (
            typeof q.options === "string"
              ? (JSON.parse(q.options) as string[])
              : (q.options as string[])
          ) ?? [];

          // Reconstituer le mapping du mélange côté serveur
          const shuffledOptions = shuffleDeterministic(
            options.map((_, i) => i),
            `${session.shuffleSeed}-opt-${q.id}`,
          );
          const submittedIndex = parseInt(resp.answer, 10);
          if (!isNaN(submittedIndex) && submittedIndex >= 0 && submittedIndex < shuffledOptions.length) {
            resolvedQcmIndex = resolveOriginalIndex(submittedIndex, shuffledOptions);
          }
        }

        try {
          const result = await gradeResponse({
            questionType: q.type,
            studentAnswer: resp.answer,
            justification: resp.justification ?? undefined,
            rubric,
            questionText: q.question,
            maxPoints: q.points,
            resolvedQcmIndex,
          });

          await db
            .update(responses)
            .set({
              score: result.score,
              maxScore: result.maxPoints,
              isCorrect: result.isCorrect,
              llmFeedback: result.feedback,
              gradingMode: result.gradingMode,
              llmConfidence: result.llmConfidence != null
                ? String(result.llmConfidence.toFixed(2))
                : null,
              gradingReason: result.feedback,
              partialCreditApplied: result.partialCreditApplied,
              gradedAt: new Date(),
            })
            .where(eq(responses.id, resp.id));

          totalScore += result.score;
          gradedCount++;
        } catch (e) {
          logger.error("Erreur correction réponse", {
            responseId: resp.id,
            error: String(e),
          });
          totalScore += resp.score ?? 0;
        }
      }

      // Mettre à jour le score total de la session
      const normalizedScore = totalMax > 0
        ? parseFloat(((totalScore / totalMax) * 20).toFixed(2))
        : 0;

      await db
        .update(sessions)
        .set({
          totalScore,
          maxScore: totalMax,
          normalizedScore: normalizedScore.toFixed(2),
        })
        .where(eq(sessions.id, sessionId));

      logger.info("Session corrigée", { sessionId, totalScore, totalMax, gradedCount });

      return {
        success: true,
        sessionId,
        totalScore,
        maxScore: totalMax,
        normalizedScore,
        gradedCount,
      };
    }),

  /**
   * Résultats détaillés d'une session (prof uniquement).
   */
  getResults: teacherQuery
    .input(z.object({ sessionId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();

      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session introuvable" });
      }

      const resps = await db
        .select()
        .from(responses)
        .where(eq(responses.sessionId, input.sessionId));

      const qs = await db
        .select({
          id: questions.id,
          type: questions.type,
          question: questions.question,
          points: questions.points,
          order: questions.order,
          // correctAnswer et gradingRubric uniquement côté serveur
          correctAnswer: questions.correctAnswer,
        })
        .from(questions)
        .where(eq(questions.evaluationId, session.evaluationId))
        .orderBy(questions.order);

      const questionMap = new Map(qs.map((q) => [q.id, q]));

      const details = resps.map((r) => {
        const q = questionMap.get(r.questionId);
        return {
          questionId: r.questionId,
          questionText: q?.question ?? "(inconnue)",
          questionType: q?.type ?? "short_answer",
          order: q?.order ?? 0,
          answer: r.answer,
          justification: r.justification,
          score: r.score ?? 0,
          maxScore: q?.points ?? 0,
          isCorrect: r.isCorrect ?? false,
          feedback: r.llmFeedback ?? null,
          gradingMode: r.gradingMode ?? null,
          llmConfidence: r.llmConfidence ? parseFloat(r.llmConfidence) : null,
          partialCreditApplied: r.partialCreditApplied,
          gradedAt: r.gradedAt,
        };
      }).sort((a, b) => a.order - b.order);

      return {
        sessionId: input.sessionId,
        studentName: session.studentName,
        studentEmail: session.studentEmail,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        totalScore: session.totalScore ?? 0,
        maxScore: session.maxScore ?? 0,
        normalizedScore: session.normalizedScore
          ? parseFloat(session.normalizedScore)
          : null,
        details,
      };
    }),

  /**
   * Correction manuelle (override) par l'enseignant.
   */
  overrideGrade: teacherQuery
    .input(
      z.object({
        responseId: z.number().int().positive(),
        score: z.number().min(0),
        feedback: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      await db
        .update(responses)
        .set({
          score: input.score,
          llmFeedback: input.feedback ?? null,
          gradingMode: "manual_override",
          gradedAt: new Date(),
        })
        .where(eq(responses.id, input.responseId));

      return { success: true };
    }),
});

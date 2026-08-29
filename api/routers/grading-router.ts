/**
 * api/routers/grading-router.ts — Phase 2
 *
 * Remplace api/grading-router.ts (ancien, basé sur authedQuery + prompt naïf).
 * Ce router délègue à `api/grading/grade-session.ts`, moteur partagé avec
 * `session.submit` : une copie est corrigée de la même façon qu'elle ait été
 * rendue par l'élève ou recorrigée par l'enseignant.
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
import { gradeSessionResponses } from "../grading/grade-session";

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

      const [session] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session introuvable" });
      }

      const result = await gradeSessionResponses(input.sessionId);

      return { success: true, sessionId: input.sessionId, ...result };
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

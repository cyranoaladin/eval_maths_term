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
import { assertSessionAccessible } from "../queries/ownership";
import { responses, sessions, questions } from "@db/schema";
import { eq } from "drizzle-orm";
import { gradeSessionResponses } from "../grading/grade-session";
import { toDecimal, toNumber, toNumberOr } from "../lib/decimal";
import { readResponseState, recordGradeAudit } from "../grading/grade-audit";
import { gradeAudit } from "@db/schema";
import { desc } from "drizzle-orm";

export const gradingRouter2 = createRouter({
  /**
   * Corrige toutes les réponses d'une session.
   * Utilise le moteur Phase 2 : exact → numeric → symbolic → fraction → set → LLM.
   * Idempotent : re-corriger une session met à jour les scores existants.
   */
  gradeSession: teacherQuery
    .input(
      z.object({
        sessionId: z.number().int().positive(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertSessionAccessible(input.sessionId, ctx.user.id);
      const db = getDb();

      const [avant] = await db
        .select({ totalScore: sessions.totalScore })
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);

      const result = await gradeSessionResponses(input.sessionId);

      // Une recorrection change la note sans intervention humaine sur une
      // réponse précise : on la trace au niveau de la copie pour que l'écart
      // reste explicable.
      await recordGradeAudit({
        sessionId: input.sessionId,
        action: "regrade",
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        oldScore: toNumber(avant?.totalScore ?? null),
        newScore: result.totalScore,
        reason: input.reason ?? null,
      });

      return { success: true, sessionId: input.sessionId, ...result };
    }),

  /**
   * Résultats détaillés d'une session (prof uniquement).
   */
  getResults: teacherQuery
    .input(z.object({ sessionId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await assertSessionAccessible(input.sessionId, ctx.user.id);
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
          score: toNumberOr(r.score, 0),
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
        totalScore: toNumberOr(session.totalScore, 0),
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
        /**
         * Motif de la modification. Exigé : une note changée sans explication
         * est indéfendable devant un élève ou une famille.
         */
        reason: z.string().min(3).max(500),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      const avant = await readResponseState(input.responseId);
      if (!avant) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Réponse introuvable" });
      }
      // Modifier une note exige d'être l'enseignant de l'évaluation, pas
      // seulement d'être enseignant.
      await assertSessionAccessible(avant.sessionId, ctx.user.id);

      // Le barème de la question borne la note : on ne peut pas attribuer
      // plus de points que la question n'en vaut.
      const [question] = await db
        .select({ points: questions.points })
        .from(questions)
        .where(eq(questions.id, avant.questionId))
        .limit(1);

      const plafond = question?.points ?? input.score;
      if (input.score > plafond) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cette question vaut ${plafond} point(s) : impossible d'en attribuer ${input.score}.`,
        });
      }

      const nouvelleNote = Math.round(input.score * 4) / 4;

      await db
        .update(responses)
        .set({
          score: toDecimal(nouvelleNote),
          isCorrect: nouvelleNote >= plafond,
          llmFeedback: input.feedback ?? null,
          gradingMode: "manual_override",
          gradingReason: input.reason,
          gradedAt: new Date(),
        })
        .where(eq(responses.id, input.responseId));

      await recordGradeAudit({
        sessionId: avant.sessionId,
        responseId: avant.id,
        questionId: avant.questionId,
        actorId: ctx.user.id,
        actorEmail: ctx.user.email,
        action: "manual_override",
        oldScore: toNumber(avant.score),
        newScore: nouvelleNote,
        oldMode: avant.gradingMode,
        newMode: "manual_override",
        reason: input.reason,
      });

      // Les totaux de la copie doivent refléter la nouvelle note. La note
      // manuelle qu'on vient de poser est préservée par `estNoteManuelle`.
      const totaux = await gradeSessionResponses(avant.sessionId);

      return { success: true, ...totaux };
    }),

  /** Historique des interventions sur une copie — lecture seule. */
  auditTrail: teacherQuery
    .input(z.object({ sessionId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await assertSessionAccessible(input.sessionId, ctx.user.id);
      const db = getDb();
      const lignes = await db
        .select()
        .from(gradeAudit)
        .where(eq(gradeAudit.sessionId, input.sessionId))
        .orderBy(desc(gradeAudit.createdAt), desc(gradeAudit.id));

      return lignes.map((l) => ({
        id: l.id,
        action: l.action,
        auteur: l.actorEmail,
        questionId: l.questionId,
        responseId: l.responseId,
        ancienneNote: toNumber(l.oldScore),
        nouvelleNote: toNumber(l.newScore),
        ancienMode: l.oldMode,
        nouveauMode: l.newMode,
        motif: l.reason,
        requestId: l.requestId,
        date: l.createdAt,
      }));
    }),
});

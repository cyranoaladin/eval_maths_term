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
 *
 * `getResults` vivait ici : une seconde lecture des résultats d'une copie, pour
 * le même public que `session.getDetailsForTeacher`, que l'interface utilise.
 * Deux façons de répondre à la même question, c'est deux mises en forme à
 * garder cohérentes sans que rien ne l'impose.
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
import { toDecimal, toNumber } from "../lib/decimal";
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

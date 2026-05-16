/**
 * api/routers/answer-router.ts
 *
 * Sauvegarde des réponses élèves en cours de session.
 * Règles :
 * - Une réponse par (sessionId, questionId) — upsert.
 * - Session doit être en cours et non expirée (assertSessionActive via session-router helper).
 * - Réponse au maximum MAX_ANSWER_LEN caractères.
 * - Ne déclenche PAS la correction — celle-ci se fait à la soumission finale (submit).
 * - gradingRubric n'est JAMAIS renvoyée au client.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, studentQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { responses, sessions, questions } from "@db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";

const MAX_ANSWER_LEN = 2000;
const MAX_JUSTIFICATION_LEN = 1000;

export const answerRouter = createRouter({
  /**
   * Sauvegarde (upsert) d'une réponse pour une question donnée.
   * Accessible uniquement aux élèves avec un token de session valide.
   */
  save: studentQuery
    .input(
      z.object({
        questionId: z.number().int().positive(),
        answer: z.string().max(MAX_ANSWER_LEN),
        justification: z.string().max(MAX_JUSTIFICATION_LEN).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { sessionId, evaluationId } = ctx.studentSession;
      const db = getDb();

      // Vérifier que la session est toujours active
      const [session] = await db
        .select({ status: sessions.status, expiresAt: sessions.expiresAt })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session introuvable" });
      }
      if (session.status !== "in_progress") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Session terminée" });
      }
      if (session.expiresAt && Date.now() > session.expiresAt.getTime()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Session expirée" });
      }

      // Vérifier que la question appartient bien à l'évaluation de la session
      const [question] = await db
        .select({ id: questions.id, type: questions.type })
        .from(questions)
        .where(
          and(
            eq(questions.id, input.questionId),
            eq(questions.evaluationId, evaluationId),
          ),
        )
        .limit(1);

      if (!question) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Question introuvable pour cette évaluation",
        });
      }

      // Upsert de la réponse
      const existing = await db
        .select({ id: responses.id })
        .from(responses)
        .where(
          and(
            eq(responses.sessionId, sessionId),
            eq(responses.questionId, input.questionId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(responses)
          .set({
            answer: input.answer,
            justification: input.justification ?? null,
          })
          .where(eq(responses.id, existing[0].id));
        logger.debug("Réponse mise à jour", {
          sessionId,
          questionId: input.questionId,
        });
      } else {
        await db.insert(responses).values({
          sessionId,
          questionId: input.questionId,
          answer: input.answer,
          justification: input.justification ?? null,
          maxScore: 0, // sera rempli à la correction finale
          partialCreditApplied: false,
        });
        logger.debug("Réponse créée", {
          sessionId,
          questionId: input.questionId,
        });
      }

      return { saved: true };
    }),

  /**
   * Retourne les réponses sauvegardées pour la session en cours.
   * Utile pour l'élève de reprendre là où il en était.
   * Ne renvoie que les champs nécessaires (pas le score, pas le feedback).
   */
  getSaved: studentQuery.query(async ({ ctx }) => {
    const { sessionId } = ctx.studentSession;
    const db = getDb();

    const saved = await db
      .select({
        questionId: responses.questionId,
        answer: responses.answer,
        justification: responses.justification,
      })
      .from(responses)
      .where(eq(responses.sessionId, sessionId));

    return saved;
  }),
});

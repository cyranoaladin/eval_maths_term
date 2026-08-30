/**
 * api/routers/answer-router.ts
 *
 * Brouillons d'une copie en cours.
 *
 * Ce routeur portait aussi une route `save` qui écrivait directement dans
 * `responses` — la table des réponses corrigées — et une route `getSaved` qui
 * les relisait. Aucune des deux n'avait d'appelant : le client enregistre des
 * brouillons, et la copie n'entre dans `responses` qu'à la remise, par
 * `session.submit`. C'était donc un second chemin d'écriture vers la table
 * notée, ouvert à tout porteur d'un jeton élève, hors du contrôle de la remise.
 *
 * Les règles de validité — session en cours, temps non écoulé, question
 * appartenant à l'évaluation — vivent dans `queries/session-access.ts`, avec
 * celles de la remise.
 */
import { z } from "zod";
import { createRouter, studentQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { answerDrafts } from "@db/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  assertQuestionDeLEvaluation,
  assertSessionActive,
} from "../queries/session-access";

const MAX_ANSWER_LEN = 2000;
const MAX_JUSTIFICATION_LEN = 1000;

export const answerRouter = createRouter({
  /**
   * Enregistrement automatique d'un brouillon.
   *
   * Un brouillon n'est pas une réponse rendue : il reste dans `answer_drafts`
   * jusqu'à la remise — volontaire ou automatique — qui seule alimente
   * `responses`. C'est ce qui permet de retrouver une copie après un
   * rechargement de page ou une coupure réseau.
   */
  saveDraft: studentQuery
    .input(
      z.object({
        questionId: z.number().int().positive(),
        answer: z.string().max(MAX_ANSWER_LEN),
        justification: z.string().max(MAX_JUSTIFICATION_LEN).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { sessionId, evaluationId } = ctx.studentSession;

      await assertSessionActive(sessionId);
      await assertQuestionDeLEvaluation(input.questionId, evaluationId);

      const db = getDb();
      const cible = and(
        eq(answerDrafts.sessionId, sessionId),
        eq(answerDrafts.questionId, input.questionId),
      );

      const existant = await db
        .select({ sessionId: answerDrafts.sessionId })
        .from(answerDrafts)
        .where(cible)
        .limit(1);

      if (existant.length > 0) {
        await db
          .update(answerDrafts)
          .set({ answer: input.answer, justification: input.justification ?? null })
          .where(cible);
      } else {
        await db.insert(answerDrafts).values({
          sessionId,
          questionId: input.questionId,
          answer: input.answer,
          justification: input.justification ?? null,
        });
      }

      logger.debug("Brouillon enregistré", { sessionId, questionId: input.questionId });
      return { saved: true };
    }),

  /**
   * Brouillons de la session en cours — de quoi restaurer l'écran après un
   * rechargement de page.
   */
  listDrafts: studentQuery.query(async ({ ctx }) => {
    const { sessionId } = ctx.studentSession;
    const db = getDb();

    const brouillons = await db
      .select({
        questionId: answerDrafts.questionId,
        answer: answerDrafts.answer,
        justification: answerDrafts.justification,
        updatedAt: answerDrafts.updatedAt,
      })
      .from(answerDrafts)
      .where(eq(answerDrafts.sessionId, sessionId));

    return brouillons.filter((b) => b.answer !== null);
  }),
});

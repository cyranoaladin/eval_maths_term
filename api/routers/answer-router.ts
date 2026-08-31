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
import { TRPCError } from "@trpc/server";
import { createRouter, studentQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { answerDrafts } from "@db/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { checkRateLimit, RateLimits } from "../lib/rate-limit";
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
        /**
         * Version monotone du brouillon, produite par le client, par question.
         *
         * Elle n'ordonne que les écritures d'un même élève sur son propre
         * brouillon. Absente, elle vaut zéro : une écriture sans version reste
         * acceptée, comme avant.
         */
        clientVersion: z.number().int().nonnegative().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { sessionId, evaluationId } = ctx.studentSession;

      // La seule écriture qu'un élève peut répéter à volonté : sans borne, une
      // boucle côté client sollicite la base pour toute la salle.
      if (
        !checkRateLimit(
          `answer-draft:${sessionId}`,
          RateLimits.answerSave.max,
          RateLimits.answerSave.windowMs,
        )
      ) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Trop d'enregistrements successifs",
        });
      }

      await assertSessionActive(sessionId);
      await assertQuestionDeLEvaluation(input.questionId, evaluationId);

      const db = getDb();

      /*
        Un seul ordre, et c'est la base qui tranche.

        L'écriture était précédée d'une lecture : « existe-t-il déjà un
        brouillon pour cette question ? », puis un INSERT ou un UPDATE selon la
        réponse. Deux enregistrements simultanés pour la même question lisaient
        tous deux « non », inséraient tous deux, et le second butait sur la clé
        primaire — l'élève recevait une erreur 500.

        Le cas n'a rien d'exotique : le client enregistre à la frappe, avec une
        temporisation, et vide sa file d'attente au retour du réseau. Plusieurs
        enregistrements de la même question partent alors ensemble. Une mesure
        de charge sous coupure réseau l'a reproduit.
      */
      /*
        Et la version décide qui gagne.

        L'ordre d'arrivée ne dit rien de l'ordre de frappe. Au retour du réseau,
        la file hors ligne se vide pendant que l'élève écrit encore : un
        brouillon composé avant la coupure peut arriver après une saisie plus
        récente. Sans arbitre, il l'écrasait.

        La comparaison se fait dans l'ordre SQL, en une seule instruction :
        `VALUES(clientVersion)` est celle qui arrive, `clientVersion` celle qui
        est en place. Une version plus ancienne laisse la ligne intacte ; une
        version égale écrit, parce que deux frappes indiscernables le sont
        vraiment.
      */
      const version = input.clientVersion ?? 0;
      await db
        .insert(answerDrafts)
        .values({
          sessionId,
          questionId: input.questionId,
          answer: input.answer,
          justification: input.justification ?? null,
          clientVersion: version,
        })
        .onDuplicateKeyUpdate({
          set: {
            answer: sql`if(values(\`clientVersion\`) >= \`clientVersion\`, values(\`answer\`), \`answer\`)`,
            justification: sql`if(values(\`clientVersion\`) >= \`clientVersion\`, values(\`justification\`), \`justification\`)`,
            clientVersion: sql`greatest(\`clientVersion\`, values(\`clientVersion\`))`,
          },
        });

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

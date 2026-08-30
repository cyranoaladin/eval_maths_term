import { z } from "zod";
import { createRouter, studentQuery, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { questions, evaluations } from "@db/schema";
import { eq } from "drizzle-orm";
import type { PublicQuestion, PublicEvaluationInfo } from "@contracts/public-types";
import { shuffleDeterministic } from "../grading/shuffle";
import { optionShuffleSeed } from "../grading/grade-session";
import { modeSaisie } from "../grading/input-mode";
import type { GradingRubric } from "@contracts/grading-rubric";

export const questionRouter = createRouter({
  /**
   * III.1 — Route protégée par studentQuery : renvoie les questions SANS correctAnswer.
   * L'ordre est mélangé de façon déterministe selon le shuffleSeed de la session.
   * Les options QCM sont également mélangées.
   */
  getForActiveSession: studentQuery
    .query(async ({ ctx }) => {
      const { evaluationId, shuffleSeed } = ctx.studentSession;
      const db = getDb();

      const qs = await db
        .select({
          id: questions.id,
          type: questions.type,
          question: questions.question,
          options: questions.options,
          justificationRequired: questions.justificationRequired,
          points: questions.points,
          order: questions.order,
          imageUrl: questions.imageUrl,
          // Lu pour en dériver la seule nature du champ de saisie. Le barème
          // lui-même ne quitte jamais cette fonction.
          gradingRubric: questions.gradingRubric,
          // CRITIQUE : correctAnswer est exclu volontairement — ne jamais le renvoyer au client
        })
        .from(questions)
        .where(eq(questions.evaluationId, evaluationId))
        .orderBy(questions.order);

      const safeQuestions: PublicQuestion[] = qs.map((q) => ({
        id: q.id,
        type: q.type,
        question: q.question,
        options: (() => {
          if (!q.options) return null;
          const parsed = typeof q.options === "string"
            ? (JSON.parse(q.options) as string[])
            : (q.options as string[]);
          // Mélange des options QCM avec une graine dérivée (seed + questionId).
          // `optionShuffleSeed` est partagée avec la correction : sans graine
          // commune, l'index soumis serait relu dans un autre ordre.
          return q.type === "qcm"
            ? shuffleDeterministic(parsed, optionShuffleSeed(shuffleSeed, q.id))
            : parsed;
        })(),
        justificationRequired: q.justificationRequired ?? false,
        points: q.points,
        order: q.order,
        imageUrl: q.imageUrl ?? null,
        ...(q.type === "short_answer"
          ? { inputMode: modeSaisie(q.gradingRubric as GradingRubric | null) }
          : {}),
      }));

      // Mélange des questions selon le shuffleSeed (mulberry32)
      return shuffleDeterministic(safeQuestions, shuffleSeed);
    }),

  /**
   * Informations publiques d'une évaluation (avant démarrage de session).
   * Ne contient aucune question, aucune réponse.
   */
  getPublicInfo: publicQuery
    .input(z.object({ evaluationId: z.number() }))
    .query(async ({ input }): Promise<PublicEvaluationInfo | null> => {
      const db = getDb();
      const [evalRow] = await db
        .select()
        .from(evaluations)
        .where(eq(evaluations.id, input.evaluationId))
        .limit(1);

      if (!evalRow) return null;

      const qs = await db
        .select({ points: questions.points })
        .from(questions)
        .where(eq(questions.evaluationId, input.evaluationId));

      return {
        id: evalRow.id,
        title: evalRow.title,
        description: evalRow.description ?? null,
        duration: evalRow.duration,
        questionCount: qs.length,
        // Calculé depuis les questions en base : MAX_SCORE ne vaut que pour
        // l'évaluation de référence et deviendrait faux dès la deuxième.
        maxScore: qs.reduce((sum, q) => sum + q.points, 0),
      };
    }),
});

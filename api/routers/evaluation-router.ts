/**
 * api/routers/evaluation-router.ts
 *
 * Remplace `api/evaluation-router.ts` (supprimé en Phase 3.5), dont toutes les
 * routes étaient `publicQuery` : il renvoyait `correctAnswer` au navigateur,
 * acceptait une soumission sans jeton et laissait lire les résultats de
 * n'importe quelle session par simple incrément d'identifiant.
 *
 * Découpage :
 *   - listPublic (publicQuery)   : catalogue élève, champs publics uniquement
 *   - listForTeacher (teacher)   : lignes complètes pour le dashboard
 *   - seed (teacher)             : upsert idempotent de l'évaluation de référence
 *
 * Le passage d'une évaluation se fait par `session.start` puis
 * `question.getForActiveSession` — jamais par ce routeur.
 */
import { createRouter, publicQuery, teacherQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { evaluations, questions } from "@db/schema";
import { eq } from "drizzle-orm";
import { seedEvaluation } from "@db/seed-evaluation";
import { logger } from "../lib/logger";

export interface PublicEvaluationSummary {
  id: number;
  title: string;
  description: string | null;
  duration: number;
  questionCount: number;
  maxScore: number;
}

export const evaluationRouter = createRouter({
  /**
   * Catalogue des évaluations actives, tel que vu par un élève non authentifié.
   * Ne contient ni question, ni réponse, ni rubric.
   */
  listPublic: publicQuery.query(async (): Promise<PublicEvaluationSummary[]> => {
    const db = getDb();

    const rows = await db
      .select({
        id: evaluations.id,
        title: evaluations.title,
        description: evaluations.description,
        duration: evaluations.duration,
      })
      .from(evaluations)
      .where(eq(evaluations.isActive, true));

    return Promise.all(
      rows.map(async (e) => {
        const qs = await db
          .select({ points: questions.points })
          .from(questions)
          .where(eq(questions.evaluationId, e.id));

        return {
          ...e,
          questionCount: qs.length,
          maxScore: qs.reduce((sum, q) => sum + q.points, 0),
        };
      }),
    );
  }),

  /** Liste complète pour le dashboard enseignant. */
  listForTeacher: teacherQuery.query(async () => {
    const db = getDb();
    return db.select().from(evaluations);
  }),

  /**
   * Upsert de l'évaluation de référence et de ses questions.
   * Remplace l'ancien `init`, qui supprimait puis réinsérait les questions
   * sans leur `gradingRubric` — le moteur de correction ne pouvait alors
   * plus corriger une seule réponse.
   */
  seed: teacherQuery.mutation(async ({ ctx }) => {
    const result = await seedEvaluation();
    logger.info("[evaluation] Seed exécuté", {
      by: ctx.user.email,
      ...result,
    });
    return { success: true, ...result };
  }),
});

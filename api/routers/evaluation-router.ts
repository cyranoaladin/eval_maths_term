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
 *
 * Il y avait ici deux autres routes, sans appelant :
 *
 * `listForTeacher` renvoyait *toutes* les évaluations à *tout* enseignant, sans
 * filtre de propriété — le contraire de la règle de cloisonnement que le reste
 * du code applique. L'atelier de rédaction utilise `authoring.listEvaluations`,
 * qui ne rend que les siennes.
 *
 * `seed` écrivait l'évaluation de démonstration dans la base depuis un compte
 * enseignant. Sur une installation de production, c'était un bouton pour
 * ajouter des données de test aux vraies. Le peuplement reste possible en
 * ligne de commande, où il relève d'une décision d'exploitation.
 *
 * Le passage d'une évaluation se fait par `session.start` puis
 * `question.getForActiveSession` — jamais par ce routeur.
 */
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { evaluations, questions } from "@db/schema";
import { eq } from "drizzle-orm";

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
});

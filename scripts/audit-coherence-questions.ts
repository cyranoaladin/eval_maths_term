/**
 * scripts/audit-coherence-questions.ts
 *
 * Soumet la réponse annoncée de chaque question au barème de cette question,
 * exactement comme une copie d'élève, et signale celles qui n'obtiennent pas
 * tous les points.
 *
 * Une question porte deux descriptions de sa bonne réponse : celle qu'on montre
 * à l'enseignant, et la règle qui note les copies. Rien ne les liait pour les
 * réponses courtes ; les écritures créées avant ce contrôle n'ont donc jamais
 * été vérifiées. Ce script le fait, sur une base réelle, sans rien modifier.
 *
 * À lancer avant une mise en production, et après toute reprise de barème.
 *
 *   DATABASE_URL=<url> npx tsx scripts/audit-coherence-questions.ts
 *
 * Sortie 0 : tout s'accorde. Sortie 2 : au moins une divergence, listée.
 */
import "dotenv/config";
import { asc, eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { evaluations, questions } from "../db/schema";
import { GradingRubricSchema } from "../contracts/grading-rubric";
import { verifierQueLeBaremeReconnaitLaReponse } from "../api/authoring/coherence-bareme";

async function main() {
  const db = getDb();
  const lignes = await db
    .select({
      id: questions.id,
      evaluationId: questions.evaluationId,
      evaluation: evaluations.title,
      order: questions.order,
      type: questions.type,
      question: questions.question,
      correctAnswer: questions.correctAnswer,
      points: questions.points,
      gradingRubric: questions.gradingRubric,
    })
    .from(questions)
    .innerJoin(evaluations, eq(evaluations.id, questions.evaluationId))
    .orderBy(asc(questions.evaluationId), asc(questions.order));

  if (lignes.length === 0) {
    console.log("Aucune question en base.");
    process.exit(0);
  }

  const divergentes: string[] = [];
  const sansBareme: string[] = [];
  let indecidables = 0;

  for (const q of lignes) {
    const situe = `#${q.id} « ${q.evaluation} » Q${q.order}`;

    if (!q.gradingRubric) {
      sansBareme.push(`${situe} : aucun barème — la question ne peut pas être corrigée.`);
      continue;
    }
    const rubric = GradingRubricSchema.safeParse(q.gradingRubric);
    if (!rubric.success) {
      sansBareme.push(`${situe} : barème illisible — ${rubric.error.issues[0]?.message}`);
      continue;
    }

    const v = await verifierQueLeBaremeReconnaitLaReponse({
      type: q.type,
      question: q.question,
      correctAnswer: q.correctAnswer,
      points: q.points,
      gradingRubric: rubric.data,
    });

    if (v.raison.includes("correction assistée")) {
      indecidables++;
      continue;
    }
    if (!v.reconnue) {
      divergentes.push(
        `${situe} : la fiche annonce « ${q.correctAnswer} », le barème lui donne ${v.score}/${q.points} — ${v.raison}`,
      );
    }
  }

  console.log(`${lignes.length} question(s) examinées.`);
  if (indecidables > 0) {
    console.log(
      `${indecidables} demandent une relecture par le modèle : leur cohérence ne peut pas être établie ici.`,
    );
  }

  if (sansBareme.length > 0) {
    console.log(`\n✗ ${sansBareme.length} sans barème exploitable :`);
    for (const l of sansBareme) console.log(`  ${l}`);
  }
  if (divergentes.length > 0) {
    console.log(`\n✗ ${divergentes.length} divergence(s) :`);
    for (const l of divergentes) console.log(`  ${l}`);
    console.log(
      "\nRien n'a été modifié. C'est le barème qui note les copies : décidez\n" +
        "lequel des deux est faux avant de laisser passer une épreuve.",
    );
  }

  if (sansBareme.length + divergentes.length > 0) process.exit(2);
  console.log("\n✓ Chaque question annonce une réponse que son propre barème reconnaît.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Échec :", e);
  process.exit(1);
});

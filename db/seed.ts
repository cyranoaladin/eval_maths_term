/**
 * db/seed.ts — seed idempotent Phase 2
 *
 * Stratégie :
 * 1. Upsert de l'évaluation "Terminale Spécialité" par titre exact.
 * 2. Pour chaque question, upsert par (evaluationId, order).
 *    - gradingRubric stocké en JSON sans exposer les corrections au client.
 *    - tags et difficulty insérés.
 * 3. Idempotent : re-exécuter le script ne crée pas de doublons.
 *
 * Usage : npx tsx db/seed.ts
 */
import "dotenv/config";
import { eq, and } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { evaluations, questions } from "./schema";
import {
  EVALUATION_TITLE,
  EVALUATION_DESCRIPTION,
  EVALUATION_DURATION,
  evaluationQuestions,
} from "../contracts/evaluation-data";

async function seed() {
  const db = getDb();
  console.log("🌱 Seeding database…");

  // ── 1. Upsert évaluation ──────────────────────────────────────────────────
  const existing = await db
    .select({ id: evaluations.id })
    .from(evaluations)
    .where(eq(evaluations.title, EVALUATION_TITLE))
    .limit(1);

  let evaluationId: number;

  if (existing.length > 0) {
    evaluationId = existing[0].id;
    await db
      .update(evaluations)
      .set({
        description: EVALUATION_DESCRIPTION,
        duration: EVALUATION_DURATION,
        isActive: true,
      })
      .where(eq(evaluations.id, evaluationId));
    console.log(`  ↺  Évaluation mise à jour (id=${evaluationId})`);
  } else {
    const [inserted] = await db.insert(evaluations).values({
      title: EVALUATION_TITLE,
      description: EVALUATION_DESCRIPTION,
      duration: EVALUATION_DURATION,
      isActive: true,
    });
    evaluationId = inserted.insertId;
    console.log(`  ✚  Évaluation créée (id=${evaluationId})`);
  }

  // ── 2. Upsert questions ───────────────────────────────────────────────────
  let created = 0;
  let updated = 0;

  for (const q of evaluationQuestions) {
    const existingQ = await db
      .select({ id: questions.id })
      .from(questions)
      .where(
        and(
          eq(questions.evaluationId, evaluationId),
          eq(questions.order, q.order),
        ),
      )
      .limit(1);

    const values = {
      evaluationId,
      type: q.type,
      question: q.question,
      options: q.options ?? null,
      correctAnswer: q.correctAnswer,
      justificationRequired: q.justificationRequired ?? false,
      points: q.points,
      order: q.order,
      imageUrl: q.imageUrl ?? null,
      gradingRubric: q.gradingRubric ?? null,
      tags: q.tags ?? null,
      difficulty: q.difficulty ?? null,
    };

    if (existingQ.length > 0) {
      await db
        .update(questions)
        .set(values)
        .where(eq(questions.id, existingQ[0].id));
      updated++;
    } else {
      await db.insert(questions).values(values);
      created++;
    }
  }

  console.log(
    `  ✚  Questions créées: ${created} | mises à jour: ${updated} (total: ${evaluationQuestions.length})`,
  );
  console.log("✅ Seed terminé.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed échoué :", err);
  process.exit(1);
});

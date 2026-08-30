/**
 * db/seed-evaluation.ts
 *
 * Upsert idempotent de l'évaluation de référence et de ses questions.
 * Extrait de `db/seed.ts` pour être réutilisable depuis la route
 * `evaluation.seed` (enseignant) sans déclencher le `process.exit` du script.
 *
 * Idempotence :
 * - l'évaluation est identifiée par son titre exact ;
 * - chaque question par le couple (evaluationId, order).
 * La `gradingRubric` est écrite ici et n'est jamais exposée au client.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { evaluations, questions } from "./schema";
import {
  EVALUATION_TITLE,
  EVALUATION_DESCRIPTION,
  EVALUATION_DURATION,
  evaluationQuestions,
} from "../contracts/evaluation-data";

export interface SeedResult {
  evaluationId: number;
  created: number;
  updated: number;
  total: number;
}

export async function seedEvaluation(): Promise<SeedResult> {
  const db = getDb();

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
  } else {
    const [inserted] = await db.insert(evaluations).values({
      title: EVALUATION_TITLE,
      description: EVALUATION_DESCRIPTION,
      duration: EVALUATION_DURATION,
      isActive: true,
    });
    evaluationId = Number(inserted.insertId);
  }

  let created = 0;
  let updated = 0;

  for (const q of evaluationQuestions) {
    const existingQ = await db
      .select({ id: questions.id })
      .from(questions)
      .where(
        and(eq(questions.evaluationId, evaluationId), eq(questions.order, q.order)),
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
      await db.update(questions).set(values).where(eq(questions.id, existingQ[0].id));
      updated++;
    } else {
      await db.insert(questions).values(values);
      created++;
    }
  }

  return { evaluationId, created, updated, total: evaluationQuestions.length };
}

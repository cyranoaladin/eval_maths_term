/**
 * api/paper/paper-service.ts
 *
 * Production des documents imprimables d'un tirage.
 *
 * Un tirage = une évaluation imprimée pour une classe. Chaque tirage a son
 * dossier, nommé d'après son identifiant : deux impressions simultanées ne
 * peuvent pas se marcher dessus, et les documents restent téléchargeables tant
 * que le tirage existe.
 */
import { asc, eq } from "drizzle-orm";
import { join, resolve } from "node:path";
import { getDb } from "../queries/connection";
import { evaluations, paperCopies, paperExams, questions, students } from "@db/schema";
import { GradingRubricSchema } from "@contracts/grading-rubric";
import { buildAmcDocument } from "./amc-template";
import { runAmc, type AmcArtifact } from "./amc-runner";
import { logger } from "../lib/logger";

/** Racine des dossiers de tirage. Hors du dépôt, configurable. */
export function paperRoot(): string {
  return resolve(process.env.PAPER_OUTPUT_DIR ?? join(process.cwd(), ".paper-exams"));
}

export function workdirFor(paperExamId: number): string {
  return join(paperRoot(), `exam-${paperExamId}`);
}

/** Documents téléchargeables — liste fermée, aucune traversée de chemin possible. */
export const DOWNLOADABLE: Record<string, { label: string; type: string }> = {
  "sujet.pdf": { label: "Sujet à imprimer", type: "application/pdf" },
  "corrige.pdf": { label: "Corrigé", type: "application/pdf" },
  "catalog.pdf": { label: "Catalogue des questions", type: "application/pdf" },
};

export interface GenerateResult {
  paperExamId: number;
  artifacts: AmcArtifact[];
  includedQuestionIds: number[];
  excluded: Array<{ id: number; reason: string }>;
  studentCount: number;
}

export async function generatePaperExam(args: {
  paperExamId: number;
  userId: number;
}): Promise<GenerateResult> {
  const db = getDb();

  const [exam] = await db
    .select()
    .from(paperExams)
    .where(eq(paperExams.id, args.paperExamId))
    .limit(1);
  if (!exam) throw new Error(`Tirage ${args.paperExamId} introuvable`);

  const [evaluation] = await db
    .select()
    .from(evaluations)
    .where(eq(evaluations.id, exam.evaluationId))
    .limit(1);
  if (!evaluation) throw new Error("Évaluation introuvable");

  const qs = await db
    .select()
    .from(questions)
    .where(eq(questions.evaluationId, exam.evaluationId))
    .orderBy(asc(questions.order));

  const roster = await db
    .select()
    .from(students)
    .where(eq(students.classId, exam.classId))
    .orderBy(asc(students.lastName));

  const actifs = roster.filter((s) => s.active);
  if (actifs.length === 0) {
    throw new Error("Cette classe n'a aucun élève actif : rien à imprimer.");
  }

  const doc = buildAmcDocument({
    title: evaluation.title,
    subtitle: exam.label ?? undefined,
    durationMinutes: evaluation.duration,
    questions: qs.map((q) => ({
      id: q.id,
      type: q.type,
      question: q.question,
      options:
        typeof q.options === "string"
          ? (JSON.parse(q.options) as string[])
          : (q.options as string[] | null),
      order: q.order,
      points: q.points,
      gradingRubric: q.gradingRubric
        ? GradingRubricSchema.safeParse(q.gradingRubric).data ?? null
        : null,
    })),
    students: actifs.map((s) => ({ lastName: s.lastName, firstName: s.firstName })),
  });

  if (doc.includedQuestionIds.length === 0) {
    throw new Error(
      "Aucune question n'est imprimable sur une feuille-réponses : ajoutez des QCM ou des vrai/faux.",
    );
  }

  const workdir = workdirFor(exam.id);
  const { artifacts } = await runAmc({
    workdir,
    tex: doc.tex,
    studentsCsv: doc.studentsCsv,
  });

  // Une copie par élève, dans l'ordre du CSV : c'est cet ordre qu'AMC
  // numérote, et celui que l'enseignant retrouvera à la saisie.
  await db.transaction(async (tx) => {
    await tx.delete(paperCopies).where(eq(paperCopies.paperExamId, exam.id));
    for (const [i, s] of actifs.entries()) {
      await tx.insert(paperCopies).values({
        paperExamId: exam.id,
        studentId: s.id,
        copyNumber: i + 1,
      });
    }
    await tx
      .update(paperExams)
      .set({
        status: "generated",
        workdir,
        generatedAt: new Date(),
        // Fige la composition : la saisie se fera contre ce papier-là.
        printedQuestionIds: doc.includedQuestionIds,
      })
      .where(eq(paperExams.id, exam.id));
  });

  logger.info("[paper] Tirage produit", {
    paperExamId: exam.id,
    eleves: actifs.length,
    questions: doc.includedQuestionIds.length,
    ecartees: doc.excluded.length,
  });

  return {
    paperExamId: exam.id,
    artifacts,
    includedQuestionIds: doc.includedQuestionIds,
    excluded: doc.excluded,
    studentCount: actifs.length,
  };
}

/**
 * api/routers/paper-router.ts — Phase 4, lot E
 *
 * Classes, listes d'élèves et tirages papier.
 * Toutes les routes exigent le rôle enseignant : elles produisent le corrigé.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { createRouter, teacherQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  classes, evaluations, paperCopies, paperExams, questions, responses, sessions, students,
} from "@db/schema";
import { parseRoster } from "../paper/parse-roster";
import { generatePaperExam, DOWNLOADABLE } from "../paper/paper-service";
import { isAmcAvailable } from "../paper/amc-runner";
import { answerToChoice, saveManualEntry } from "../paper/manual-entry";
import { anonymizeStudent, exportStudentData } from "../paper/student-data";
import { logger } from "../lib/logger";
import { toNumber } from "../lib/decimal";

async function assertOwnedClass(classId: number, userId: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(classes)
    .where(and(eq(classes.id, classId), eq(classes.ownerId, userId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Classe introuvable" });
  return row;
}

export const paperRouter = createRouter({
  /** Disponibilité d'AMC : permet à l'IHM d'expliquer plutôt que d'échouer. */
  status: teacherQuery.query(async () => ({ amcAvailable: await isAmcAvailable() })),

  // ─── Classes ──────────────────────────────────────────────────────────────

  listClasses: teacherQuery.query(async ({ ctx }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(classes)
      .where(eq(classes.ownerId, ctx.user.id))
      .orderBy(asc(classes.name));

    const compte = await db
      .select({ classId: students.classId, n: sql<number>`COUNT(*)` })
      .from(students)
      .groupBy(students.classId);
    const parClasse = new Map(compte.map((c) => [c.classId, Number(c.n)]));

    return rows.map((c) => ({ ...c, studentCount: parClasse.get(c.id) ?? 0 }));
  }),

  createClass: teacherQuery
    .input(
      z.object({
        name: z.string().min(1).max(120),
        level: z.string().max(80).optional(),
        subject: z.string().max(80).optional(),
        schoolYear: z.string().max(16).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [row] = await db.insert(classes).values({
        ownerId: ctx.user.id,
        name: input.name,
        level: input.level ?? null,
        subject: input.subject ?? null,
        schoolYear: input.schoolYear ?? null,
      });
      return { id: Number(row.insertId) };
    }),

  listStudents: teacherQuery
    .input(z.object({ classId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      await assertOwnedClass(input.classId, ctx.user.id);
      const db = getDb();
      return db
        .select()
        .from(students)
        .where(eq(students.classId, input.classId))
        .orderBy(asc(students.lastName), asc(students.firstName));
    }),

  /**
   * Import d'une liste depuis un CSV de vie scolaire.
   * Les lignes écartées sont retournées avec leur motif : un import silencieux
   * qui perd trois élèves ne se remarque qu'au moment d'imprimer.
   */
  importStudents: teacherQuery
    .input(
      z.object({
        classId: z.number().int().positive(),
        csv: z.string().min(1).max(2_000_000),
        replace: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertOwnedClass(input.classId, ctx.user.id);
      const db = getDb();
      const parsed = parseRoster(input.csv);

      if (parsed.students.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            parsed.skipped[0]?.reason ?? "Aucun élève n'a pu être lu dans ce fichier.",
        });
      }

      const existants = await db
        .select({ lastName: students.lastName, firstName: students.firstName })
        .from(students)
        .where(eq(students.classId, input.classId));
      const deja = new Set(existants.map((e) => `${e.lastName}|${e.firstName}`.toLowerCase()));

      let inseres = 0;
      let ignores = 0;

      await db.transaction(async (tx) => {
        if (input.replace) {
          await tx.delete(students).where(eq(students.classId, input.classId));
          deja.clear();
        }
        for (const s of parsed.students) {
          const cle = `${s.lastName}|${s.firstName}`.toLowerCase();
          if (deja.has(cle)) {
            ignores++;
            continue;
          }
          await tx.insert(students).values({
            classId: input.classId,
            lastName: s.lastName,
            firstName: s.firstName,
            email: s.email ?? null,
          });
          deja.add(cle);
          inseres++;
        }
      });

      logger.info("[paper] Liste importée", {
        classId: input.classId,
        inseres,
        ignores,
        ecartes: parsed.skipped.length,
      });

      return {
        inserted: inseres,
        alreadyPresent: ignores,
        skipped: parsed.skipped,
        separator: parsed.separator,
        nameColumn: parsed.nameColumn,
      };
    }),

  // ─── Données personnelles (RGPD) ──────────────────────────────────────────

  /** Droit d'accès : tout ce que l'application détient sur un élève. */
  exportStudentData: teacherQuery
    .input(z.object({ studentId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const [eleve] = await db
        .select({ classId: students.classId })
        .from(students)
        .where(eq(students.id, input.studentId))
        .limit(1);
      if (!eleve) throw new TRPCError({ code: "NOT_FOUND", message: "Élève introuvable" });
      await assertOwnedClass(eleve.classId, ctx.user.id);

      logger.info("[rgpd] Export de données demandé", {
        studentId: input.studentId,
        by: ctx.user.email,
      });
      return exportStudentData(input.studentId);
    }),

  /**
   * Droit à l'effacement, par anonymisation.
   * Supprimer l'élève emporterait les notes d'évaluations déjà rendues, que
   * l'établissement doit conserver. L'identité est retirée, les résultats non.
   */
  anonymizeStudent: teacherQuery
    .input(z.object({ studentId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [eleve] = await db
        .select({ classId: students.classId })
        .from(students)
        .where(eq(students.id, input.studentId))
        .limit(1);
      if (!eleve) throw new TRPCError({ code: "NOT_FOUND", message: "Élève introuvable" });
      await assertOwnedClass(eleve.classId, ctx.user.id);

      logger.warn("[rgpd] Anonymisation demandée", {
        studentId: input.studentId,
        by: ctx.user.email,
      });
      return anonymizeStudent(input.studentId);
    }),

  // ─── Tirages ──────────────────────────────────────────────────────────────

  listExams: teacherQuery
    .input(z.object({ evaluationId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({
          id: paperExams.id,
          label: paperExams.label,
          status: paperExams.status,
          generatedAt: paperExams.generatedAt,
          createdAt: paperExams.createdAt,
          classId: paperExams.classId,
          className: classes.name,
        })
        .from(paperExams)
        .leftJoin(classes, eq(classes.id, paperExams.classId))
        .where(eq(paperExams.evaluationId, input.evaluationId))
        .orderBy(asc(paperExams.id));

      const copies = await db
        .select({ paperExamId: paperCopies.paperExamId, n: sql<number>`COUNT(*)` })
        .from(paperCopies)
        .groupBy(paperCopies.paperExamId);
      const parTirage = new Map(copies.map((c) => [c.paperExamId, Number(c.n)]));

      return rows.map((r) => ({ ...r, copyCount: parTirage.get(r.id) ?? 0 }));
    }),

  // ─── Saisie manuelle ──────────────────────────────────────────────────────

  /**
   * Tout ce qu'il faut pour saisir : les questions **telles qu'imprimées**, les
   * élèves du tirage, et ce qui a déjà été saisi.
   */
  entrySheet: teacherQuery
    .input(z.object({ paperExamId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const { exam, className, evaluationTitle } = await loadOwnedExam(
        input.paperExamId,
        ctx.user.id,
      );
      const db = getDb();

      const ids = exam.printedQuestionIds ?? [];
      if (ids.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Ce tirage n'a pas encore été généré : aucun sujet n'a été imprimé.",
        });
      }

      const qs = await db
        .select({
          id: questions.id,
          type: questions.type,
          question: questions.question,
          options: questions.options,
          points: questions.points,
        })
        .from(questions)
        .where(inArray(questions.id, ids));

      const parId = new Map(qs.map((q) => [q.id, q]));

      // L'ordre imprimé fait foi, pas l'ordre courant en base.
      const sheetQuestions = ids
        .map((id, index) => {
          const q = parId.get(id);
          if (!q) return null;
          const options =
            typeof q.options === "string"
              ? (JSON.parse(q.options) as string[])
              : (q.options as string[] | null);
          return {
            id: q.id,
            position: index + 1,
            type: q.type,
            text: q.question,
            points: q.points,
            choiceCount: q.type === "true_false" ? 2 : options?.length ?? 0,
          };
        })
        .filter((q): q is NonNullable<typeof q> => q !== null);

      const copies = await db
        .select({
          copyId: paperCopies.id,
          copyNumber: paperCopies.copyNumber,
          studentId: students.id,
          lastName: students.lastName,
          firstName: students.firstName,
          sessionId: paperCopies.sessionId,
          enteredAt: paperCopies.enteredAt,
          totalScore: sessions.totalScore,
          maxScore: sessions.maxScore,
          normalizedScore: sessions.normalizedScore,
        })
        .from(paperCopies)
        .innerJoin(students, eq(students.id, paperCopies.studentId))
        .leftJoin(sessions, eq(sessions.id, paperCopies.sessionId))
        .where(eq(paperCopies.paperExamId, input.paperExamId))
        .orderBy(asc(paperCopies.copyNumber));

      const sessionIds = copies.map((c) => c.sessionId).filter((v): v is number => v !== null);
      const saisies = sessionIds.length
        ? await db
            .select({
              sessionId: responses.sessionId,
              questionId: responses.questionId,
              answer: responses.answer,
              score: responses.score,
            })
            .from(responses)
            .where(inArray(responses.sessionId, sessionIds))
        : [];

      const typeParId = new Map(sheetQuestions.map((q) => [q.id, q.type]));
      const parSession = new Map<number, Record<number, number | null>>();
      const notesParSession = new Map<number, Record<number, number>>();
      for (const r of saisies) {
        const type = typeParId.get(r.questionId);
        if (type) {
          const bloc = parSession.get(r.sessionId) ?? {};
          bloc[r.questionId] = answerToChoice(type, r.answer);
          parSession.set(r.sessionId, bloc);
          continue;
        }
        // Question rédigée : c'est la note attribuée qu'on réaffiche.
        const points = toNumber(r.score);
        if (points !== null) {
          const bloc = notesParSession.get(r.sessionId) ?? {};
          bloc[r.questionId] = points;
          notesParSession.set(r.sessionId, bloc);
        }
      }

      // Questions rédigées : hors grille, mais notables à la main sur copie.
      const redigees = await db
        .select({
          id: questions.id,
          question: questions.question,
          points: questions.points,
          order: questions.order,
        })
        .from(questions)
        .where(eq(questions.evaluationId, exam.evaluationId))
        .orderBy(asc(questions.order));

      const openQuestions = redigees
        .filter((q) => !ids.includes(q.id))
        .map((q) => ({ id: q.id, text: q.question, points: q.points }));

      return {
        exam: {
          id: exam.id,
          label: exam.label,
          status: exam.status,
          className,
          evaluationTitle,
        },
        questions: sheetQuestions,
        openQuestions,
        copies: copies.map((c) => ({
          studentId: c.studentId,
          // Nécessaire à l'écran de correction : c'est la copie corrigée.
          sessionId: c.sessionId,
          name: `${c.lastName} ${c.firstName}`.trim(),
          copyNumber: c.copyNumber,
          entered: c.enteredAt !== null,
          answers: c.sessionId ? parSession.get(c.sessionId) ?? {} : {},
          openMarks: c.sessionId ? notesParSession.get(c.sessionId) ?? {} : {},
          totalScore: toNumber(c.totalScore),
          maxScore: c.maxScore,
          normalizedScore: c.normalizedScore !== null ? parseFloat(c.normalizedScore) : null,
        })),
      };
    }),

  /**
   * Enregistre une copie et la note aussitôt.
   * Ressaisir une copie la remplace : l'enseignant voit la note se corriger.
   */
  saveEntry: teacherQuery
    .input(
      z.object({
        paperExamId: z.number().int().positive(),
        studentId: z.number().int().positive(),
        answers: z.array(
          z.object({
            questionId: z.number().int().positive(),
            choiceIndex: z.number().int().min(0).max(9).nullable(),
          }),
        ),
        /** Points des questions rédigées, corrigées à la main sur la copie. */
        openMarks: z
          .array(
            z.object({
              questionId: z.number().int().positive(),
              score: z.number().min(0).max(100),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await loadOwnedExam(input.paperExamId, ctx.user.id);
      const db = getDb();

      const [eleve] = await db
        .select({ lastName: students.lastName, firstName: students.firstName })
        .from(students)
        .where(eq(students.id, input.studentId))
        .limit(1);
      if (!eleve) throw new TRPCError({ code: "NOT_FOUND", message: "Élève introuvable" });

      try {
        return await saveManualEntry({
          paperExamId: input.paperExamId,
          studentId: input.studentId,
          studentName: `${eleve.lastName} ${eleve.firstName}`.trim(),
          answers: input.answers,
          openMarks: input.openMarks,
          enteredById: ctx.user.id,
          acteur: { id: ctx.user.id, email: ctx.user.email },
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }),

  /** Notes du tirage, prêtes à exporter. */
  results: teacherQuery
    .input(z.object({ paperExamId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const { exam, className, evaluationTitle } = await loadOwnedExam(
        input.paperExamId,
        ctx.user.id,
      );
      const db = getDb();

      const rows = await db
        .select({
          lastName: students.lastName,
          firstName: students.firstName,
          copyNumber: paperCopies.copyNumber,
          enteredAt: paperCopies.enteredAt,
          totalScore: sessions.totalScore,
          maxScore: sessions.maxScore,
          normalizedScore: sessions.normalizedScore,
        })
        .from(paperCopies)
        .innerJoin(students, eq(students.id, paperCopies.studentId))
        .leftJoin(sessions, eq(sessions.id, paperCopies.sessionId))
        .where(eq(paperCopies.paperExamId, input.paperExamId))
        .orderBy(asc(students.lastName), asc(students.firstName));

      const notes = rows
        .map((r) => (r.normalizedScore !== null ? parseFloat(r.normalizedScore) : null))
        .filter((n): n is number => n !== null);

      return {
        exam: { id: exam.id, label: exam.label, className, evaluationTitle },
        rows: rows.map((r) => ({
          name: `${r.lastName} ${r.firstName}`.trim(),
          copyNumber: r.copyNumber,
          entered: r.enteredAt !== null,
          totalScore: toNumber(r.totalScore),
          maxScore: r.maxScore,
          normalizedScore: r.normalizedScore !== null ? parseFloat(r.normalizedScore) : null,
        })),
        stats: {
          entered: rows.filter((r) => r.enteredAt !== null).length,
          total: rows.length,
          average:
            notes.length > 0
              ? Math.round((notes.reduce((a, b) => a + b, 0) / notes.length) * 100) / 100
              : null,
          min: notes.length ? Math.min(...notes) : null,
          max: notes.length ? Math.max(...notes) : null,
        },
      };
    }),

  /** Crée un tirage puis produit les documents dans la foulée. */
  createAndGenerate: teacherQuery
    .input(
      z.object({
        evaluationId: z.number().int().positive(),
        classId: z.number().int().positive(),
        label: z.string().max(160).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertOwnedClass(input.classId, ctx.user.id);
      const db = getDb();

      const [evaluation] = await db
        .select()
        .from(evaluations)
        .where(eq(evaluations.id, input.evaluationId))
        .limit(1);
      if (!evaluation) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Évaluation introuvable" });
      }

      const [row] = await db.insert(paperExams).values({
        evaluationId: input.evaluationId,
        classId: input.classId,
        label: input.label ?? null,
        createdById: ctx.user.id,
        status: "draft",
      });
      const paperExamId = Number(row.insertId);

      try {
        const result = await generatePaperExam({ paperExamId, userId: ctx.user.id });
        return {
          ...result,
          downloads: result.artifacts.map((a) => ({
            file: a.file,
            label: DOWNLOADABLE[a.file]?.label ?? a.label,
            url: `/api/paper/${paperExamId}/${a.file}`,
            bytes: a.bytes,
          })),
        };
      } catch (e) {
        // Un tirage qui n'a rien produit ne doit pas rester en base.
        await db.delete(paperExams).where(eq(paperExams.id, paperExamId));
        const message = e instanceof Error ? e.message : String(e);
        logger.error("[paper] Tirage abandonné", { paperExamId, error: message });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),
});

/** Charge un tirage en vérifiant qu'il appartient bien à l'enseignant. */
async function loadOwnedExam(paperExamId: number, userId: number) {
  const db = getDb();
  const [row] = await db
    .select({
      exam: paperExams,
      className: classes.name,
      evaluationTitle: evaluations.title,
    })
    .from(paperExams)
    .innerJoin(classes, eq(classes.id, paperExams.classId))
    .innerJoin(evaluations, eq(evaluations.id, paperExams.evaluationId))
    .where(and(eq(paperExams.id, paperExamId), eq(classes.ownerId, userId)))
    .limit(1);

  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Tirage introuvable" });
  return row;
}

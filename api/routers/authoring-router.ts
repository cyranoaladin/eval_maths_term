/**
 * api/routers/authoring-router.ts — Phase 4
 *
 * Édition des évaluations et des questions par l'enseignant.
 * Toutes les routes sont `teacherQuery` : ce routeur manipule `correctAnswer`
 * et `gradingRubric`, qui ne doivent jamais atteindre un client élève.
 *
 * Toute écriture de question passe par `validateQuestionCoherence` : la base
 * accepterait sans broncher une question dont la fiche et le barème divergent,
 * et elle noterait faux en silence.
 *
 * Propriété : une évaluation appartient à son créateur. Les évaluations sans
 * propriétaire (celles d'avant la Phase 4, dont le jeu de démonstration) restent
 * visibles de tous — sans quoi le seed deviendrait inaccessible.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { asc, eq, isNull, or, sql } from "drizzle-orm";
import { createRouter, teacherQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { evaluations, questions, sessions } from "@db/schema";
import { GradingRubricSchema } from "@contracts/grading-rubric";
import { validateQuestionCoherence } from "@contracts/question-coherence";
import { generateQuestions } from "../authoring/generate-questions";
import { currentModel, isLlmConfigured } from "../llm/chat";
import { getRagProvider, searchContext } from "../rag/rag-provider";
import { checkRateLimit } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  assertEvaluationAccessible,
  assertQuestionAccessible,
} from "../queries/ownership";

const QuestionTypeSchema = z.enum(["qcm", "short_answer", "true_false"]);

const QuestionInputSchema = z.object({
  type: QuestionTypeSchema,
  question: z.string().min(1).max(5000),
  options: z.array(z.string().max(500)).max(8).nullable().optional(),
  correctAnswer: z.string().max(500),
  justificationRequired: z.boolean().optional(),
  points: z.number().int().min(1).max(20),
  gradingRubric: GradingRubricSchema,
  tags: z.array(z.string().max(60)).max(10).optional(),
  difficulty: z.number().int().min(1).max(3).optional(),
  imageUrl: z.string().max(500).nullable().optional(),
});

/** Refuse l'écriture d'une question incohérente, avec le détail des motifs. */
function assertCoherent(input: z.infer<typeof QuestionInputSchema>) {
  const verdict = validateQuestionCoherence({
    type: input.type,
    question: input.question,
    options: input.options ?? null,
    correctAnswer: input.correctAnswer,
    points: input.points,
    justificationRequired: input.justificationRequired,
    gradingRubric: input.gradingRubric,
  });
  if (!verdict.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: verdict.errors.join(" "),
      cause: verdict.errors,
    });
  }
}

/** Charge une évaluation en vérifiant que l'enseignant a le droit d'y toucher. */
export const authoringRouter = createRouter({
  // ─── Évaluations ──────────────────────────────────────────────────────────

  listEvaluations: teacherQuery.query(async ({ ctx }) => {
    const db = getDb();

    const rows = await db
      .select()
      .from(evaluations)
      .where(or(eq(evaluations.ownerId, ctx.user.id), isNull(evaluations.ownerId)))
      .orderBy(asc(evaluations.id));

    // Agrégats en requêtes séparées plutôt qu'en sous-requêtes corrélées :
    // dans un template `sql`, Drizzle rend `${evaluations.id}` sans qualifier
    // la table, et la référence se relie alors à la table de la sous-requête.
    const parQuestion = await db
      .select({
        evaluationId: questions.evaluationId,
        n: sql<number>`COUNT(*)`,
        points: sql<number>`COALESCE(SUM(${questions.points}), 0)`,
      })
      .from(questions)
      .groupBy(questions.evaluationId);

    const parSession = await db
      .select({
        evaluationId: sessions.evaluationId,
        n: sql<number>`COUNT(*)`,
      })
      .from(sessions)
      .groupBy(sessions.evaluationId);

    const qStats = new Map(parQuestion.map((r) => [r.evaluationId, r]));
    const sStats = new Map(parSession.map((r) => [r.evaluationId, r]));

    return rows.map((e) => ({
      ...e,
      // MySQL renvoie SUM en DECIMAL, donc en chaîne côté driver.
      questionCount: Number(qStats.get(e.id)?.n ?? 0),
      maxScore: Number(qStats.get(e.id)?.points ?? 0),
      sessionCount: Number(sStats.get(e.id)?.n ?? 0),
    }));
  }),

  /** Évaluation complète avec ses questions — rubric incluse (enseignant). */
  getEvaluation: teacherQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const evaluation = await assertEvaluationAccessible(input.id, ctx.user.id);
      const db = getDb();

      const qs = await db
        .select()
        .from(questions)
        .where(eq(questions.evaluationId, input.id))
        .orderBy(asc(questions.order));

      return {
        evaluation,
        questions: qs.map((q) => ({
          ...q,
          options: parseOptions(q.options),
          gradingRubric: q.gradingRubric
            ? GradingRubricSchema.safeParse(q.gradingRubric).data ?? null
            : null,
        })),
        maxScore: qs.reduce((sum, q) => sum + q.points, 0),
      };
    }),

  createEvaluation: teacherQuery
    .input(
      z.object({
        title: z.string().min(1).max(255),
        description: z.string().max(2000).optional(),
        duration: z.number().int().min(5).max(300).default(60),
        deliveryMode: z.enum(["online", "paper", "both"]).default("paper"),
        subject: z.string().max(80).optional(),
        level: z.string().max(80).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [row] = await db.insert(evaluations).values({
        title: input.title,
        description: input.description ?? null,
        duration: input.duration,
        deliveryMode: input.deliveryMode,
        subject: input.subject ?? null,
        level: input.level ?? null,
        ownerId: ctx.user.id,
        // Une évaluation naît inactive : elle ne doit pas être passable
        // tant qu'elle n'a pas de questions.
        isActive: false,
      });

      const id = Number(row.insertId);
      logger.info("[authoring] Évaluation créée", { id, by: ctx.user.email });
      return { id };
    }),

  updateEvaluation: teacherQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        title: z.string().min(1).max(255).optional(),
        description: z.string().max(2000).nullable().optional(),
        duration: z.number().int().min(5).max(300).optional(),
        deliveryMode: z.enum(["online", "paper", "both"]).optional(),
        subject: z.string().max(80).nullable().optional(),
        level: z.string().max(80).nullable().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertEvaluationAccessible(input.id, ctx.user.id);
      const db = getDb();
      const { id, ...fields } = input;

      // Une évaluation sans question ne peut pas être activée.
      if (fields.isActive === true) {
        const [{ n }] = await db
          .select({ n: sql<number>`COUNT(*)` })
          .from(questions)
          .where(eq(questions.evaluationId, id));
        if (Number(n) === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Impossible d'activer une évaluation sans question.",
          });
        }
      }

      await db.update(evaluations).set(fields).where(eq(evaluations.id, id));
      return { success: true };
    }),

  deleteEvaluation: teacherQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await assertEvaluationAccessible(input.id, ctx.user.id);
      const db = getDb();

      // La clé étrangère est en RESTRICT : on donne un motif lisible plutôt
      // que de laisser remonter une erreur SQL.
      const [{ n }] = await db
        .select({ n: sql<number>`COUNT(*)` })
        .from(sessions)
        .where(eq(sessions.evaluationId, input.id));

      if (Number(n) > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Cette évaluation a déjà ${n} copie(s) : elle ne peut pas être supprimée. Désactivez-la plutôt.`,
        });
      }

      await db.delete(questions).where(eq(questions.evaluationId, input.id));
      await db.delete(evaluations).where(eq(evaluations.id, input.id));
      logger.info("[authoring] Évaluation supprimée", { id: input.id, by: ctx.user.email });
      return { success: true };
    }),

  /** Duplique une évaluation et toutes ses questions — base d'un nouveau sujet. */
  duplicateEvaluation: teacherQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        title: z.string().min(1).max(255).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const source = await assertEvaluationAccessible(input.id, ctx.user.id);
      const db = getDb();

      const qs = await db
        .select()
        .from(questions)
        .where(eq(questions.evaluationId, input.id))
        .orderBy(asc(questions.order));

      const [row] = await db.insert(evaluations).values({
        title: input.title ?? `${source.title} (copie)`,
        description: source.description,
        duration: source.duration,
        deliveryMode: source.deliveryMode,
        subject: source.subject,
        level: source.level,
        ownerId: ctx.user.id,
        isActive: false,
      });
      const newId = Number(row.insertId);

      for (const q of qs) {
        await db.insert(questions).values({
          evaluationId: newId,
          type: q.type,
          question: q.question,
          options: q.options,
          correctAnswer: q.correctAnswer,
          justificationRequired: q.justificationRequired,
          points: q.points,
          gradingRubric: q.gradingRubric,
          order: q.order,
          imageUrl: q.imageUrl,
          tags: q.tags,
          difficulty: q.difficulty,
        });
      }

      logger.info("[authoring] Évaluation dupliquée", {
        from: input.id,
        to: newId,
        questions: qs.length,
      });
      return { id: newId, questionCount: qs.length };
    }),

  // ─── Assistance LLM ───────────────────────────────────────────────────────

  /** État de la configuration LLM, pour que l'IHM se dégrade proprement. */
  llmStatus: teacherQuery.query(() => ({
    configured: isLlmConfigured(),
    model: isLlmConfigured() ? currentModel() : null,
    /** Le RAG est facultatif : sans lui, la génération marche sans ancrage. */
    ragAvailable: getRagProvider().available,
  })),

  /**
   * Propose des questions à partir d'un thème.
   *
   * **N'écrit rien en base.** Les propositions reviennent à l'enseignant, qui
   * les relit et les enregistre une par une via `createQuestion` — lequel
   * applique les mêmes contrôles de cohérence qu'une saisie manuelle.
   */
  generateQuestions: teacherQuery
    .input(
      z.object({
        evaluationId: z.number().int().positive(),
        theme: z.string().min(3).max(300),
        count: z.number().int().min(1).max(10).default(3),
        difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!isLlmConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Aucune clé LLM configurée : renseignez LLM_API_KEY pour utiliser la génération assistée.",
        });
      }

      // La génération coûte des jetons : on borne les appels par enseignant.
      if (!checkRateLimit(`generate:${ctx.user.id}`, 12, 5 * 60 * 1000)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Trop de générations en peu de temps. Patientez quelques minutes.",
        });
      }

      const evaluation = await assertEvaluationAccessible(input.evaluationId, ctx.user.id);
      const db = getDb();

      // Les énoncés déjà présents servent à éviter les redites.
      const existing = await db
        .select({ question: questions.question })
        .from(questions)
        .where(eq(questions.evaluationId, input.evaluationId));

      // Ancrage documentaire quand le port est branché. Une panne du RAG ne
      // bloque pas la rédaction : `searchContext` retourne alors une liste vide.
      const passages = await searchContext(
        [input.theme, evaluation.level, evaluation.subject].filter(Boolean).join(" "),
        5,
      );

      try {
        const result = await generateQuestions({
          theme: input.theme,
          count: input.count,
          difficulty: input.difficulty,
          level: evaluation.level ?? undefined,
          subject: evaluation.subject ?? undefined,
          existingQuestions: existing.map((e) => e.question),
          contextPassages: passages.map((p) => ({ source: p.source, text: p.text })),
        });

        logger.info("[authoring] Propositions générées", {
          evaluationId: input.evaluationId,
          by: ctx.user.email,
          proposees: result.proposals.length,
          extraits: passages.length,
        });

        // Les sources remontent à l'enseignant : il doit pouvoir vérifier sur
        // quoi le modèle s'est appuyé.
        return { ...result, sources: passages.map((p) => p.source) };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        logger.error("[authoring] Génération échouée", { error: message });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

  // ─── Questions ────────────────────────────────────────────────────────────

  createQuestion: teacherQuery
    .input(
      z.object({
        evaluationId: z.number().int().positive(),
        question: QuestionInputSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertEvaluationAccessible(input.evaluationId, ctx.user.id);
      assertCoherent(input.question);
      const db = getDb();

      const [{ maxOrder }] = await db
        .select({ maxOrder: sql<number | null>`MAX(${questions.order})` })
        .from(questions)
        .where(eq(questions.evaluationId, input.evaluationId));

      const q = input.question;
      const [row] = await db.insert(questions).values({
        evaluationId: input.evaluationId,
        type: q.type,
        question: q.question,
        options: q.options ?? null,
        correctAnswer: q.correctAnswer,
        justificationRequired: q.justificationRequired ?? false,
        points: q.points,
        gradingRubric: q.gradingRubric,
        order: Number(maxOrder ?? 0) + 1,
        imageUrl: q.imageUrl ?? null,
        tags: q.tags ?? null,
        difficulty: q.difficulty ?? null,
      });

      return { id: Number(row.insertId) };
    }),

  updateQuestion: teacherQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        question: QuestionInputSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertQuestionAccessible(input.id, ctx.user.id);
      assertCoherent(input.question);

      const db = getDb();

      const q = input.question;
      await db
        .update(questions)
        .set({
          type: q.type,
          question: q.question,
          options: q.options ?? null,
          correctAnswer: q.correctAnswer,
          justificationRequired: q.justificationRequired ?? false,
          points: q.points,
          gradingRubric: q.gradingRubric,
          imageUrl: q.imageUrl ?? null,
          tags: q.tags ?? null,
          difficulty: q.difficulty ?? null,
        })
        .where(eq(questions.id, input.id));

      return { success: true };
    }),

  deleteQuestion: teacherQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await assertQuestionAccessible(input.id, ctx.user.id);
      const db = getDb();

      // `responses` référence `questions` en RESTRICT : une question déjà
      // corrigée ne peut pas disparaître sans emporter l'historique.
      try {
        await db.delete(questions).where(eq(questions.id, input.id));
      } catch {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Cette question a déjà été corrigée dans au moins une copie : elle ne peut plus être supprimée.",
        });
      }
      return { success: true };
    }),

  /** Réordonne les questions ; l'ordre reçu fait foi. */
  reorderQuestions: teacherQuery
    .input(
      z.object({
        evaluationId: z.number().int().positive(),
        orderedIds: z.array(z.number().int().positive()).min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertEvaluationAccessible(input.evaluationId, ctx.user.id);
      const db = getDb();

      const existing = await db
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.evaluationId, input.evaluationId));

      const known = new Set(existing.map((q) => q.id));
      if (input.orderedIds.length !== known.size || input.orderedIds.some((id) => !known.has(id))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La liste doit contenir exactement les questions de cette évaluation.",
        });
      }

      await db.transaction(async (tx) => {
        for (const [index, id] of input.orderedIds.entries()) {
          await tx.update(questions).set({ order: index + 1 }).where(eq(questions.id, id));
        }
      });

      return { success: true };
    }),
});

function parseOptions(raw: unknown): string[] | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : null;
    } catch {
      return null;
    }
  }
  return Array.isArray(raw) ? (raw as string[]) : null;
}

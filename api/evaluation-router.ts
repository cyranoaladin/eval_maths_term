import { z } from "zod";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { evaluations, questions, sessions, responses } from "@db/schema";
import { eq } from "drizzle-orm";
import {
  evaluationQuestions,
  EVALUATION_TITLE,
  EVALUATION_DESCRIPTION,
  EVALUATION_DURATION,
  MAX_SCORE,
} from "@contracts/evaluation-data";

function safeParseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

export const evaluationRouter = createRouter({
  // Initialiser l'évaluation dans la DB (à appeler une fois au setup) — protégé par auth
  init: authedQuery.mutation(async () => {
    const db = getDb();

    // Vérifier si l'évaluation existe déjà
    const existing = await db.select().from(evaluations).limit(1);
    let evaluationId: number;

    if (existing.length > 0) {
      evaluationId = existing[0].id;
      // Supprimer les anciennes questions pour les remplacer
      await db.delete(questions).where(eq(questions.evaluationId, evaluationId));
    } else {
      // Créer l'évaluation
      const [evalRow] = await db.insert(evaluations).values({
        title: EVALUATION_TITLE,
        description: EVALUATION_DESCRIPTION,
        duration: EVALUATION_DURATION,
        isActive: true,
      });
      evaluationId = Number(evalRow.insertId);
    }

    // Créer les questions
    for (const q of evaluationQuestions) {
      await db.insert(questions).values({
        evaluationId,
        type: q.type,
        question: q.question,
        options: q.options ? JSON.stringify(q.options) : null,
        correctAnswer: q.correctAnswer,
        justificationRequired: q.justificationRequired ?? false,
        points: q.points,
        order: q.order,
      });
    }

    return { success: true, evaluationId };
  }),

  // Récupérer les questions d'une évaluation
  getQuestions: publicQuery
    .input(z.object({ evaluationId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const qs = await db
        .select()
        .from(questions)
        .where(eq(questions.evaluationId, input.evaluationId))
        .orderBy(questions.order);

      return qs.map((q) => ({
        ...q,
        options: safeParseJson<string[]>(q.options),
      }));
    }),

  // Récupérer les infos de l'évaluation
  getInfo: publicQuery
    .input(z.object({ evaluationId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [evalRow] = await db
        .select()
        .from(evaluations)
        .where(eq(evaluations.id, input.evaluationId))
        .limit(1);

      if (!evalRow) return null;

      const qs = await db
        .select()
        .from(questions)
        .where(eq(questions.evaluationId, input.evaluationId))
        .orderBy(questions.order);

      return {
        ...evalRow,
        questions: qs.map((q) => ({
          ...q,
          options: safeParseJson<string[]>(q.options),
        })),
        maxScore: MAX_SCORE,
      };
    }),

  // Récupérer toutes les évaluations
  list: publicQuery.query(async () => {
    const db = getDb();
    return db.select().from(evaluations);
  }),

  // Créer une session pour un élève
  createSession: publicQuery
    .input(
      z.object({
        evaluationId: z.number(),
        studentName: z.string().min(1),
        studentEmail: z.string().email().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const [session] = await db.insert(sessions).values({
        evaluationId: input.evaluationId,
        studentName: input.studentName,
        studentEmail: input.studentEmail || null,
        status: "in_progress",
        tabSwitchCount: 0,
        cheatEvents: [],
      });

      return {
        sessionId: Number(session.insertId),
        startedAt: new Date(),
      };
    }),

  // Mettre à jour une session (réponses, événements de triche, etc.)
  updateSession: publicQuery
    .input(
      z.object({
        sessionId: z.number(),
        status: z.enum(["in_progress", "completed", "timed_out", "cheating_detected"]).optional(),
        tabSwitchCount: z.number().optional(),
        cheatEvents: z.string().optional(),
        totalScore: z.number().optional(),
        timeSpent: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      // Vérifier que la session existe
      const [session] = await db.select().from(sessions).where(eq(sessions.id, input.sessionId)).limit(1);
      if (!session) {
        throw new Error("Session introuvable.");
      }

      // Empêcher la modification d'une session déjà terminée
      if (session.status !== "in_progress" && input.status !== undefined) {
        throw new Error("Impossible de modifier une session terminée.");
      }

      const updates: Record<string, unknown> = {};

      if (input.status !== undefined) updates.status = input.status;
      if (input.tabSwitchCount !== undefined) updates.tabSwitchCount = input.tabSwitchCount;
      if (input.cheatEvents !== undefined) updates.cheatEvents = input.cheatEvents;
      if (input.totalScore !== undefined) updates.totalScore = input.totalScore;
      if (input.timeSpent !== undefined) updates.timeSpent = input.timeSpent;
      if (input.status === "completed" || input.status === "timed_out" || input.status === "cheating_detected") {
        updates.endedAt = new Date();
      }

      await db.update(sessions).set(updates).where(eq(sessions.id, input.sessionId));
      return { success: true };
    }),

  // Soumettre les réponses
  submitAnswers: publicQuery
    .input(
      z.object({
        sessionId: z.number(),
        answers: z.array(
          z.object({
            questionId: z.number(),
            answer: z.string(),
            justification: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { sessionId, answers } = input;

      // Vérifier que la session existe et est en cours
      const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
      if (!session) {
        throw new Error("Session introuvable.");
      }
      if (session.status !== "in_progress") {
        throw new Error("Cette session est déjà terminée.");
      }

      // Récupérer les questions pour correction (filtrer par evaluationId)
      const qs = await db
        .select()
        .from(questions)
        .where(eq(questions.evaluationId, session.evaluationId));
      const questionMap = new Map(qs.map((q) => [q.id, q]));

      let totalScore = 0;

      await db.transaction(async (tx) => {
        for (const ans of answers) {
          const q = questionMap.get(ans.questionId);
          if (!q) continue;

          let isCorrect = false;
          let score = 0;
          let llmFeedback = "";

          if (q.type === "qcm") {
            // Correction automatique QCM
            const correctIndex = parseInt(q.correctAnswer);
            const studentIndex = parseInt(ans.answer);
            isCorrect = correctIndex === studentIndex;
            score = isCorrect ? q.points : 0;
          } else if (q.type === "true_false") {
            // Correction Vrai/Faux
            isCorrect = q.correctAnswer === ans.answer;
            // Si justification requise, on laisse la LLM évaluer
            if (q.justificationRequired && ans.justification) {
              score = isCorrect ? Math.round(q.points * 0.5) : 0;
              llmFeedback = "Justification à évaluer par l'enseignant.";
            } else {
              score = isCorrect ? q.points : 0;
            }
          } else if (q.type === "short_answer") {
            // Réponse courte - correction simple
            const normalizedStudent = ans.answer.toLowerCase().replace(/\s/g, "");
            const normalizedCorrect = q.correctAnswer.toLowerCase().replace(/\s/g, "");
            isCorrect = normalizedStudent === normalizedCorrect;
            score = isCorrect ? q.points : 0;
          }

          totalScore += score;

          await tx.insert(responses).values({
            sessionId,
            questionId: ans.questionId,
            answer: ans.answer,
            justification: ans.justification || null,
            isCorrect,
            score,
            maxScore: q.points,
            llmFeedback: llmFeedback || null,
            gradedAt: new Date(),
          });
        }

        // Mettre à jour la session
        await tx
          .update(sessions)
          .set({
            status: "completed",
            totalScore,
            maxScore: MAX_SCORE,
            endedAt: new Date(),
          })
          .where(eq(sessions.id, sessionId));
      });

      return { success: true, totalScore, maxScore: MAX_SCORE };
    }),

  // Récupérer les résultats d'une session
  getResults: publicQuery
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);

      if (!session) return null;

      const resps = await db
        .select()
        .from(responses)
        .where(eq(responses.sessionId, input.sessionId));

      return {
        session,
        responses: resps,
      };
    }),

  // Récupérer toutes les sessions (pour le dashboard prof) — protégé par auth
  getAllSessions: authedQuery.query(async () => {
    const db = getDb();
    return db.select().from(sessions).orderBy(sessions.startedAt);
  }),

  // Récupérer les détails complets d'une session avec questions — protégé par auth
  getSessionDetails: authedQuery
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);

      if (!session) return null;

      const resps = await db
        .select()
        .from(responses)
        .where(eq(responses.sessionId, input.sessionId));

      const qs = await db
        .select()
        .from(questions)
        .where(eq(questions.evaluationId, session.evaluationId))
        .orderBy(questions.order);

      return {
        session,
        responses: resps.map((r) => ({
          ...r,
          question: qs.find((q) => q.id === r.questionId),
        })),
      };
    }),
});

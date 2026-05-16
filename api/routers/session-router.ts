import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { createRouter, publicQuery, studentQuery, teacherQuery } from "../middleware";
import { getDb } from "../queries/connection";
import {
  evaluations,
  questions,
  sessions,
  responses,
  cheatEvents as cheatEventsTable,
} from "@db/schema";
import { eq } from "drizzle-orm";
import { MAX_SCORE } from "@contracts/evaluation-data";
import { signStudentToken, signResultsToken, verifyResultsToken } from "../anticheat/session-token";
import { logger } from "../lib/logger";
import { checkRateLimit, getClientIp, RateLimits } from "../lib/rate-limit";

function safeParseJson<T>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  return value as T;
}

/**
 * Vérifie que la session est en cours et non expirée.
 * Lève une TRPCError si la session n'est pas valide.
 * III.4 : timer serveur-autoritatif.
 */
async function assertSessionActive(sessionId: number) {
  const db = getDb();
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Session introuvable" });
  }

  if (session.status !== "in_progress") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cette session est déjà terminée",
    });
  }

  // III.4 : vérification de l'expiration côté serveur
  if (session.expiresAt && Date.now() > session.expiresAt.getTime()) {
    // Sceller automatiquement la session expirée
    await db
      .update(sessions)
      .set({ status: "timed_out", endedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Session expirée : le temps imparti est écoulé",
    });
  }

  return session;
}

export const sessionRouter = createRouter({
  /**
   * III.3 : Crée une session élève et renvoie un sessionToken JWT signé serveur.
   * Renvoie aussi serverTime pour la synchronisation du timer client.
   * III.9 : rate limit 5/min par IP.
   */
  start: publicQuery
    .input(
      z.object({
        evaluationId: z.number(),
        studentName: z.string().min(1).max(255),
        studentEmail: z.string().email().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // III.9 : rate limit sur session.start
      const ip = getClientIp(ctx.req);
      if (!checkRateLimit(`session-start:${ip}`, RateLimits.sessionStart.max, RateLimits.sessionStart.windowMs)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Trop de tentatives. Veuillez patienter une minute.",
        });
      }

      const db = getDb();

      // Vérifier que l'évaluation existe et est active
      const [evaluation] = await db
        .select()
        .from(evaluations)
        .where(eq(evaluations.id, input.evaluationId))
        .limit(1);

      if (!evaluation || !evaluation.isActive) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Évaluation introuvable ou inactive",
        });
      }

      const now = Date.now();
      // III.4 : expiration = startedAt + durée (en ms) + 30s de grâce
      const expiresAt = new Date(now + evaluation.duration * 60 * 1000 + 30 * 1000);
      const shuffleSeed = nanoid(16);

      const [row] = await db.insert(sessions).values({
        evaluationId: input.evaluationId,
        studentName: input.studentName,
        studentEmail: input.studentEmail ?? null,
        status: "in_progress",
        tabSwitchCount: 0,
        expiresAt,
        shuffleSeed,
      });

      const sessionId = Number(row.insertId);

      // III.3 : token de session élève signé avec STUDENT_SESSION_SECRET
      const sessionToken = await signStudentToken({
        sessionId,
        evaluationId: input.evaluationId,
        studentName: input.studentName,
        startedAt: now,
        expiresAt: expiresAt.getTime(),
        shuffleSeed,
      });

      logger.info("[session] Nouvelle session créée", {
        sessionId,
        evaluationId: input.evaluationId,
        studentName: input.studentName,
        expiresAt: expiresAt.toISOString(),
        ip,
      });

      return {
        sessionId,
        sessionToken,
        expiresAt: expiresAt.toISOString(),
        serverTime: new Date(now).toISOString(),
      };
    }),

  /**
   * Heartbeat : le client envoie un ping toutes les 15s.
   * Renvoie serverTime pour resynchroniser le timer client.
   * III.4 : met à jour lastHeartbeatAt.
   */
  heartbeat: studentQuery
    .mutation(async ({ ctx }) => {
      const { sessionId } = ctx.studentSession;

      // III.9 : rate limit heartbeat
      if (!checkRateLimit(`heartbeat:${sessionId}`, RateLimits.heartbeat.max, RateLimits.heartbeat.windowMs)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Trop de heartbeats",
        });
      }

      const session = await assertSessionActive(sessionId);
      const db = getDb();

      await db
        .update(sessions)
        .set({ lastHeartbeatAt: new Date() })
        .where(eq(sessions.id, sessionId));

      const remaining = session.expiresAt
        ? Math.max(0, session.expiresAt.getTime() - Date.now())
        : null;

      return {
        serverTime: new Date().toISOString(),
        remainingMs: remaining,
        status: session.status,
      };
    }),

  /**
   * III.5 : Soumet les réponses. Le score est calculé côté serveur uniquement.
   * Le client ne peut PAS envoyer totalScore.
   */
  submit: studentQuery
    .input(
      z.object({
        answers: z.array(
          z.object({
            questionId: z.number(),
            answer: z.string(),
            justification: z.string().optional(),
          }),
        ),
        timeSpent: z.number().min(0).optional(),
        isTimeout: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionId } = ctx.studentSession;
      const session = await assertSessionActive(sessionId);
      const db = getDb();

      // Récupérer les questions avec correctAnswer (côté serveur uniquement)
      const qs = await db
        .select()
        .from(questions)
        .where(eq(questions.evaluationId, session.evaluationId));

      const questionMap = new Map(qs.map((q) => [q.id, q]));
      let totalScore = 0;

      await db.transaction(async (tx) => {
        for (const ans of input.answers) {
          const q = questionMap.get(ans.questionId);
          if (!q) continue;

          let isCorrect = false;
          let score = 0;
          let llmFeedback: string | null = null;

          if (q.type === "qcm") {
            const correctIndex = parseInt(q.correctAnswer);
            const studentIndex = parseInt(ans.answer);
            isCorrect = correctIndex === studentIndex;
            score = isCorrect ? q.points : 0;
          } else if (q.type === "true_false") {
            isCorrect = q.correctAnswer === ans.answer;
            if (q.justificationRequired && ans.justification) {
              // Score partiel en attente d'évaluation LLM
              score = isCorrect ? Math.round(q.points * 0.5) : 0;
              llmFeedback = "Justification à évaluer par l'enseignant.";
            } else {
              score = isCorrect ? q.points : 0;
            }
          } else if (q.type === "short_answer") {
            // Correction naïve — sera améliorée en Phase 2 (compare-symbolic)
            const norm = (s: string) => s.toLowerCase().replace(/\s/g, "").replace(/,/g, ".");
            isCorrect = norm(ans.answer) === norm(q.correctAnswer);
            score = isCorrect ? q.points : 0;
            if (!isCorrect) {
              llmFeedback = "À évaluer par le moteur de correction mathématique.";
            }
          }

          totalScore += score;

          await tx.insert(responses).values({
            sessionId,
            questionId: ans.questionId,
            answer: ans.answer,
            justification: ans.justification ?? null,
            isCorrect,
            score,
            maxScore: q.points,
            llmFeedback,
            gradedAt: new Date(),
          });
        }

        // III.5 : note sur 20 calculée serveur
        const normalizedScore = Math.round((totalScore / MAX_SCORE) * 20 * 4) / 4;

        // Détermination du statut final (III.5 : tabSwitchCount calculé depuis cheat_events)
        const cheatCount = await tx
          .select({ id: cheatEventsTable.id })
          .from(cheatEventsTable)
          .where(eq(cheatEventsTable.sessionId, sessionId));

        const finalStatus = input.isTimeout
          ? "timed_out"
          : cheatCount.length > 10
          ? "cheating_detected"
          : "completed";

        // Token de résultats à durée courte (10 min) — émis uniquement ici
        const resultsToken = await signResultsToken(sessionId);

        await tx
          .update(sessions)
          .set({
            status: finalStatus,
            totalScore,
            maxScore: MAX_SCORE,
            // III.5 : normalizedScore calculé serveur — DECIMAL(5,2) attend une string en Drizzle
            normalizedScore: (Math.round(normalizedScore * 4) / 4).toFixed(2),
            timeSpent: input.timeSpent ?? null,
            endedAt: new Date(),
            resultsToken,
          })
          .where(eq(sessions.id, sessionId));

        logger.info("[session] Session soumise", {
          sessionId,
          totalScore,
          normalizedScore,
          finalStatus,
        });
      });

      const resultsToken = await signResultsToken(sessionId);
      return {
        success: true,
        totalScore,
        maxScore: MAX_SCORE,
        normalizedScore: Math.round((totalScore / MAX_SCORE) * 20 * 4) / 4,
        resultsToken,
      };
    }),

  /**
   * Récupère les résultats d'une session via un token de résultats à durée courte.
   * III.1 : ne renvoie pas correctAnswer.
   */
  getResults: publicQuery
    .input(z.object({ resultsToken: z.string() }))
    .query(async ({ input }) => {
      let sessionId: number;
      try {
        const payload = await verifyResultsToken(input.resultsToken);
        sessionId = payload.sessionId;
      } catch {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Token de résultats invalide ou expiré",
        });
      }

      const db = getDb();
      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session introuvable" });
      }

      const resps = await db
        .select({
          id: responses.id,
          questionId: responses.questionId,
          answer: responses.answer,
          justification: responses.justification,
          isCorrect: responses.isCorrect,
          score: responses.score,
          maxScore: responses.maxScore,
          llmFeedback: responses.llmFeedback,
        })
        .from(responses)
        .where(eq(responses.sessionId, sessionId));

      return {
        sessionId: session.id,
        studentName: session.studentName,
        status: session.status,
        totalScore: session.totalScore,
        maxScore: session.maxScore,
        normalizedScore: session.normalizedScore !== null ? parseFloat(session.normalizedScore) : null,
        timeSpent: session.timeSpent,
        responses: resps,
      };
    }),

  /**
   * Récupère toutes les sessions pour le dashboard prof.
   * III.2 : exige le rôle teacher.
   */
  getAllForTeacher: teacherQuery.query(async () => {
    const db = getDb();
    return db.select().from(sessions).orderBy(sessions.startedAt);
  }),

  /**
   * Récupère les détails complets d'une session (prof seulement).
   * Inclut correctAnswer pour la correction.
   */
  getDetailsForTeacher: teacherQuery
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session introuvable" });
      }

      const resps = await db
        .select()
        .from(responses)
        .where(eq(responses.sessionId, input.sessionId));

      const qs = await db
        .select()
        .from(questions)
        .where(eq(questions.evaluationId, session.evaluationId))
        .orderBy(questions.order);

      const cheatEvts = await db
        .select()
        .from(cheatEventsTable)
        .where(eq(cheatEventsTable.sessionId, input.sessionId));

      return {
        session: {
          ...session,
          normalizedScore: session.normalizedScore !== null ? parseFloat(session.normalizedScore) : null,
        },
        responses: resps.map((r) => ({
          ...r,
          question: qs.find((q) => q.id === r.questionId),
          options: safeParseJson<string[]>(qs.find((q) => q.id === r.questionId)?.options),
        })),
        cheatEvents: cheatEvts,
      };
    }),
});

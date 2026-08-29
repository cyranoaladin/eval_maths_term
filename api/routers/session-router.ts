import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { createRouter, publicQuery, studentQuery, teacherQuery, lireJetonEleve } from "../middleware";
import { getDb } from "../queries/connection";
import {
  evaluations,
  questions,
  sessions,
  responses,
  cheatEvents as cheatEventsTable,
} from "@db/schema";
import { and, eq, isNull, or } from "drizzle-orm";
import { assertSessionAccessible } from "../queries/ownership";
import { gradeSessionResponses } from "../grading/grade-session";
import { signStudentToken, signResultsToken, verifyResultsToken } from "../anticheat/session-token";
import { processHeartbeat } from "../anticheat/heartbeat";
import { ingestEvents } from "../anticheat/event-aggregator";
import { logger } from "../lib/logger";
import { toNumber } from "../lib/decimal";
import { checkRateLimit, getClientIp, RateLimits } from "../lib/rate-limit";
import { FingerprintComponentsSchema, computeFingerprintHash } from "../anticheat/fingerprint";
import { computeSuspicionScore } from "../anticheat/score-suspicion";
import type { CheatEventType } from "@db/schema";

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
        fingerprintComponents: z.record(z.string(), z.unknown()).optional(),
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

      // Phase 3 : fingerprint + IP initiaux
      const fpParsed = input.fingerprintComponents
        ? FingerprintComponentsSchema.safeParse(input.fingerprintComponents)
        : null;
      const fingerprintHash = fpParsed?.success
        ? computeFingerprintHash(fpParsed.data)
        : null;

      const [row] = await db.insert(sessions).values({
        evaluationId: input.evaluationId,
        studentName: input.studentName,
        studentEmail: input.studentEmail ?? null,
        status: "in_progress",
        tabSwitchCount: 0,
        expiresAt,
        shuffleSeed,
        ipAddress: ip,
        userAgent: ctx.req.headers.get("user-agent") ?? null,
        fingerprintHash: fingerprintHash ?? null,
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
   * Heartbeat Phase 3 : ping toutes les 15s.
   * Ingère le fingerprint + IP, détecte les mismatches, met à jour lastHeartbeatAt.
   * Déclenche l'idle-sweeper en parallèle (fire-and-forget).
   */
  heartbeat: studentQuery
    .input(
      z.object({
        clientTime: z.number(),
        focused: z.boolean(),
        currentQuestionIndex: z.number().int().nonnegative(),
        fingerprintHash: z.string().max(64),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionId } = ctx.studentSession;

      // III.9 : rate limit heartbeat
      if (!checkRateLimit(`heartbeat:${sessionId}`, RateLimits.heartbeat.max, RateLimits.heartbeat.windowMs)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Trop de heartbeats",
        });
      }

      const ip = getClientIp(ctx.req);
      const result = await processHeartbeat(
        {
          sessionToken: lireJetonEleve(ctx.req),
          ...input,
        },
        ip,
      );

      // Injecter les événements de mismatch si détectés
      const mismatchEvents = [
        ...(result.fingerprintMismatch ? [{ type: "fingerprint_mismatch" as const, timestamp: Date.now() }] : []),
        ...(result.ipMismatch          ? [{ type: "multi_device" as const,         timestamp: Date.now() }] : []),
      ];
      if (mismatchEvents.length > 0) {
        await ingestEvents(sessionId, mismatchEvents);
      }

      // Fire-and-forget idle sweeper
      import("../anticheat/idle-sweeper").then(({ runIdleSweep }) => runIdleSweep()).catch(() => {});

      return {
        serverTime: new Date().toISOString(),
        remainingMs: result.remainingMs,
        status: result.status,
        fingerprintMismatch: result.fingerprintMismatch,
        ipMismatch: result.ipMismatch,
        expired: result.expired,
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

      // Seules les questions de l'évaluation de la session sont acceptées :
      // un client malveillant ne peut pas injecter la réponse d'une autre copie.
      const qs = await db
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.evaluationId, session.evaluationId));
      const allowedIds = new Set(qs.map((q) => q.id));

      // 1. Enregistrement brut des réponses — aucun score n'est calculé ici,
      //    et surtout aucun score n'est accepté depuis le client.
      await db.transaction(async (tx) => {
        for (const ans of input.answers) {
          if (!allowedIds.has(ans.questionId)) continue;

          const [existing] = await tx
            .select({ id: responses.id })
            .from(responses)
            .where(
              and(
                eq(responses.sessionId, sessionId),
                eq(responses.questionId, ans.questionId),
              ),
            )
            .limit(1);

          if (existing) {
            await tx
              .update(responses)
              .set({
                answer: ans.answer,
                justification: ans.justification ?? null,
              })
              .where(eq(responses.id, existing.id));
          } else {
            await tx.insert(responses).values({
              sessionId,
              questionId: ans.questionId,
              answer: ans.answer,
              justification: ans.justification ?? null,
              maxScore: 0,
              partialCreditApplied: false,
            });
          }
        }
      });

      // 2. Correction par le moteur Phase 2 (déterministe puis LLM).
      const grading = await gradeSessionResponses(sessionId);

      // 3. Score de suspicion et statut final — calculés serveur, jamais reçus.
      const events = await db
        .select()
        .from(cheatEventsTable)
        .where(eq(cheatEventsTable.sessionId, sessionId));

      const suspicion = computeSuspicionScore(
        events.map((e) => ({
          type: e.type as CheatEventType,
          count: (e.metadata as { count?: number })?.count ?? 1,
        })),
      );

      const finalStatus = input.isTimeout
        ? "timed_out"
        : suspicion.verdict === "severe"
          ? "cheating_detected"
          : "completed";

      const resultsToken = await signResultsToken(sessionId);

      await db
        .update(sessions)
        .set({
          status: finalStatus,
          timeSpent: input.timeSpent ?? null,
          endedAt: new Date(),
          resultsToken,
          suspicionScore: suspicion.score,
          suspicionVerdict: suspicion.verdict,
        })
        .where(eq(sessions.id, sessionId));

      logger.info("[session] Session soumise", {
        sessionId,
        totalScore: grading.totalScore,
        normalizedScore: grading.normalizedScore,
        finalStatus,
        suspicionScore: suspicion.score,
      });

      return {
        success: true,
        totalScore: grading.totalScore,
        maxScore: grading.maxScore,
        normalizedScore: grading.normalizedScore,
        needsManualReview: grading.needsManualReview,
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

      const reponsesConverties = resps.map((r) => ({ ...r, score: toNumber(r.score) }));

      // Compté depuis la table append-only, jamais depuis le client.
      const events = await db
        .select({ id: cheatEventsTable.id })
        .from(cheatEventsTable)
        .where(eq(cheatEventsTable.sessionId, sessionId));

      return {
        sessionId: session.id,
        studentName: session.studentName,
        status: session.status,
        totalScore: toNumber(session.totalScore),
        maxScore: session.maxScore,
        normalizedScore: session.normalizedScore !== null ? parseFloat(session.normalizedScore) : null,
        timeSpent: session.timeSpent,
        cheatEventCount: events.length,
        responses: reponsesConverties,
      };
    }),

  /**
   * Récupère toutes les sessions pour le dashboard prof.
   * III.2 : exige le rôle teacher.
   */
  getAllForTeacher: teacherQuery.query(async ({ ctx }) => {
    const db = getDb();
    // Un enseignant ne voit que les copies de ses propres évaluations. Les
    // évaluations sans propriétaire restent partagées — voir
    // `api/queries/ownership.ts`.
    const rows = await db
      .select()
      .from(sessions)
      .innerJoin(evaluations, eq(evaluations.id, sessions.evaluationId))
      .where(or(eq(evaluations.ownerId, ctx.user.id), isNull(evaluations.ownerId)))
      .orderBy(sessions.startedAt)
      .then((lignes) => lignes.map((l) => l.sessions));
    // Conversion à la frontière : le pilote MySQL rend les DECIMAL en chaînes,
    // et le client fait des moyennes avec ces valeurs.
    return rows.map((s) => ({
      ...s,
      totalScore: toNumber(s.totalScore),
      normalizedScore: toNumber(s.normalizedScore),
    }));
  }),

  /**
   * Récupère les détails complets d'une session (prof seulement).
   * Inclut correctAnswer pour la correction.
   */
  getDetailsForTeacher: teacherQuery
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input, ctx }) => {
      await assertSessionAccessible(input.sessionId, ctx.user.id);
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
          totalScore: toNumber(session.totalScore),
          normalizedScore: toNumber(session.normalizedScore),
        },
        responses: resps.map((r) => ({
          ...r,
          score: toNumber(r.score),
          question: qs.find((q) => q.id === r.questionId),
          options: safeParseJson<string[]>(qs.find((q) => q.id === r.questionId)?.options),
        })),
        cheatEvents: cheatEvts,
      };
    }),
});

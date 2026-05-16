/**
 * api/routers/teacher-live-router.ts
 *
 * Dashboard temps-réel enseignant (polling 5 s côté client, pas de SSE/WebSocket).
 * Accessible uniquement aux enseignants authentifiés.
 *
 * snapshot : retourne l'état de toutes les sessions d'une évaluation.
 * forceSubmit : force l'auto-submit d'une session spécifique.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, teacherQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { sessions, cheatEvents, answerDrafts } from "@db/schema";
import { eq } from "drizzle-orm";
import { runIdleSweep } from "../anticheat/idle-sweeper";
import { autoSubmitSession } from "../anticheat/auto-submit";
import { logger } from "../lib/logger";
import type { CheatEventType } from "@db/schema";

export interface SessionSnapshot {
  sessionId: number;
  studentName: string;
  studentEmail: string | null;
  status: string;
  lastHeartbeatAt: string | null;
  idleSec: number | null;
  suspicionScore: number;
  suspicionVerdict: string;
  answeredCount: number;
  totalDrafts: number;
  cheatEventCount: number;
  topCheatTypes: CheatEventType[];
}

export const teacherLiveRouter = createRouter({
  /**
   * Snapshot de toutes les sessions en cours pour une évaluation.
   * Déclenche aussi le idle-sweeper fire-and-forget (D.5).
   * Polling recommandé : 5 s côté client (useTeacherLive hook).
   */
  snapshot: teacherQuery
    .input(z.object({ evaluationId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const now = Date.now();

      const allSessions = await db
        .select()
        .from(sessions)
        .where(eq(sessions.evaluationId, input.evaluationId));

      const snapshots: SessionSnapshot[] = await Promise.all(
        allSessions.map(async (s) => {
          // Drafts count
          const drafts = await db
            .select({ questionId: answerDrafts.questionId })
            .from(answerDrafts)
            .where(eq(answerDrafts.sessionId, s.id));

          // Cheat events
          const events = await db
            .select({ type: cheatEvents.type })
            .from(cheatEvents)
            .where(eq(cheatEvents.sessionId, s.id));

          const typeCounts = new Map<CheatEventType, number>();
          for (const e of events) {
            typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1);
          }
          const topCheatTypes = [...typeCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([t]) => t);

          const idleSec = s.lastHeartbeatAt && s.status === "in_progress"
            ? Math.floor((now - new Date(s.lastHeartbeatAt).getTime()) / 1000)
            : null;

          return {
            sessionId: s.id,
            studentName: s.studentName,
            studentEmail: s.studentEmail ?? null,
            status: s.status,
            lastHeartbeatAt: s.lastHeartbeatAt?.toISOString() ?? null,
            idleSec,
            suspicionScore: s.suspicionScore ?? 0,
            suspicionVerdict: s.suspicionVerdict ?? "clean",
            answeredCount: 0, // responses.sessionId count — omis pour éviter N+1 ici
            totalDrafts: drafts.length,
            cheatEventCount: events.length,
            topCheatTypes,
          } satisfies SessionSnapshot;
        }),
      );

      // Fire-and-forget idle sweep (D.5)
      runIdleSweep().catch(() => {});

      return {
        evaluationId: input.evaluationId,
        serverTime: new Date().toISOString(),
        sessions: snapshots,
      };
    }),

  /**
   * Force l'auto-submit d'une session spécifique (action enseignant).
   */
  forceSubmit: teacherQuery
    .input(z.object({ sessionId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [session] = await db
        .select({ status: sessions.status })
        .from(sessions)
        .where(eq(sessions.id, input.sessionId))
        .limit(1);

      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session introuvable" });
      }
      if (session.status !== "in_progress") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Session déjà terminée" });
      }

      await autoSubmitSession(input.sessionId, { reason: "manual_force" });

      logger.info("[teacher-live] Force submit", { sessionId: input.sessionId });
      return { submitted: true };
    }),
});

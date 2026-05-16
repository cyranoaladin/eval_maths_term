import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, studentQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { cheatEvents, sessions } from "@db/schema";
import { eq } from "drizzle-orm";
import { checkRateLimit, RateLimits } from "../lib/rate-limit";
import { logger } from "../lib/logger";

const CHEAT_EVENT_TYPES = [
  "tab_switch",
  "blur",
  "context_menu",
  "copy",
  "paste",
  "fullscreen_exit",
  "print",
  "devtools_open",
  "fingerprint_mismatch",
  "multi_device",
  "prolonged_blur",
] as const;

const cheatEventTypeSchema = z.enum(CHEAT_EVENT_TYPES);

/**
 * III.5 : Ingestion des événements de triche — append-only.
 * Le client ne peut PAS modifier ou supprimer les événements existants.
 * Les événements sont insérés en batch pour limiter les requêtes.
 */
export const cheatRouter = createRouter({
  report: studentQuery
    .input(
      z.object({
        events: z
          .array(
            z.object({
              type: cheatEventTypeSchema,
              timestamp: z.string().datetime(),
              metadata: z.record(z.string(), z.unknown()).optional(),
              count: z.number().min(1).max(100).default(1),
            }),
          )
          .min(1)
          .max(50),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionId } = ctx.studentSession;

      // III.9 : rate limit cheat.report
      if (
        !checkRateLimit(
          `cheat-report:${sessionId}`,
          RateLimits.cheatReport.max,
          RateLimits.cheatReport.windowMs,
        )
      ) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Trop de signalements d'événements",
        });
      }

      const db = getDb();

      // Vérifier que la session est toujours en cours
      const [session] = await db
        .select({ status: sessions.status, expiresAt: sessions.expiresAt })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

      if (!session || session.status !== "in_progress") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Session non active",
        });
      }

      // Insertion en batch des événements (append-only)
      const rows = input.events.map((event) => ({
        sessionId,
        type: event.type,
        timestamp: new Date(event.timestamp),
        metadata: event.count > 1
          ? { ...event.metadata, count: event.count }
          : (event.metadata ?? null),
      }));

      await db.insert(cheatEvents).values(rows);

      logger.info("[cheat] Événements de triche enregistrés", {
        sessionId,
        count: rows.length,
        types: rows.map((r) => r.type),
      });

      return { recorded: rows.length };
    }),
});

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, studentQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { sessions } from "@db/schema";
import { eq } from "drizzle-orm";
import { checkRateLimit, RateLimits } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { ingestEvents } from "../anticheat/event-aggregator";

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
  "idle_disconnect",
  "window_size_anomaly",
] as const;

const cheatEventTypeSchema = z.enum(CHEAT_EVENT_TYPES);

/**
 * III.5 : Ingestion des événements de triche — append-only.
 * Le client ne peut PAS modifier ou supprimer les événements existants.
 * Les événements sont insérés en batch pour limiter les requêtes.
 */
/**
 * Ingestion des incidents de surveillance — en ajout seul.
 *
 * Le client ne peut ni modifier ni supprimer ce qui est déjà consigné : ce
 * journal peut fonder une décision de l'établissement sur une copie.
 *
 * Il y avait deux routes ici. `report` acceptait des horodatages ISO, sans
 * déduplication ; `reportBatch` l'avait remplacée côté client — plus légère, et
 * dédupliquant les rafales à l'entrée. `report` n'avait plus aucun appelant, et
 * deux chemins d'écriture pour un même journal, c'est deux comportements à
 * garder cohérents pour rien. Il n'en reste qu'un.
 */
export const cheatRouter = createRouter({
  /**
   * Les rafales sont dédupliquées côté serveur (fenêtre de 500 ms) : un élève
   * qui bascule d'onglet dix fois en une seconde produit un incident, pas dix.
   */
  report: studentQuery
    .input(
      z.object({
        events: z
          .array(
            z.object({
              type: cheatEventTypeSchema,
              timestamp: z.number().int().positive(),
              count: z.number().min(1).max(100).default(1),
              metadata: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .min(1)
          .max(50),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionId } = ctx.studentSession;

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
      const [session] = await db
        .select({ status: sessions.status })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

      if (!session || session.status !== "in_progress") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Session non active" });
      }

      const result = await ingestEvents(sessionId, input.events);

      logger.info("[cheat] Incidents consignés", {
        sessionId,
        accepted: result.accepted,
        deduplicated: result.deduplicated,
      });

      return { accepted: result.accepted, deduplicated: result.deduplicated };
    }),
});

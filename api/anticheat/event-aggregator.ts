/**
 * api/anticheat/event-aggregator.ts
 *
 * Ingestion et dédoublonnage côté serveur des événements de triche.
 * Le client envoie déjà des événements coalescés (useCheatBuffer),
 * mais on dédoublonne en plus dans une fenêtre de SERVER_COALESCE_WINDOW_MS
 * pour absorber les race conditions réseau.
 */
import { eq, and, gte } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { cheatEvents } from "@db/schema";
import { SERVER_COALESCE_WINDOW_MS } from "@contracts/anticheat-config";
import type { CheatEventType } from "@db/schema";

export interface IncomingCheatEvent {
  type: CheatEventType;
  /** Epoch ms (timestamp client) */
  timestamp: number;
  /** ≥1 si coalescé côté client */
  count?: number;
  metadata?: Record<string, unknown>;
}

export interface IngestResult {
  accepted: number;
  deduplicated: number;
}

/**
 * Insère un batch d'événements pour une session.
 * Dédoublonne dans la fenêtre SERVER_COALESCE_WINDOW_MS par (sessionId, type).
 * Idempotent en cas de retry réseau.
 */
export async function ingestEvents(
  sessionId: number,
  batch: IncomingCheatEvent[],
): Promise<IngestResult> {
  const db = getDb();
  let accepted = 0;
  let deduplicated = 0;

  for (const ev of batch) {
    const since = new Date(ev.timestamp - SERVER_COALESCE_WINDOW_MS);

    const [existing] = await db
      .select({ id: cheatEvents.id })
      .from(cheatEvents)
      .where(
        and(
          eq(cheatEvents.sessionId, sessionId),
          eq(cheatEvents.type, ev.type),
          gte(cheatEvents.timestamp, since),
        ),
      )
      .limit(1);

    if (existing) {
      deduplicated++;
      continue;
    }

    await db.insert(cheatEvents).values({
      sessionId,
      type: ev.type,
      timestamp: new Date(ev.timestamp),
      metadata: {
        ...(ev.metadata ?? {}),
        count: ev.count ?? 1,
      },
    });
    accepted++;
  }

  return { accepted, deduplicated };
}

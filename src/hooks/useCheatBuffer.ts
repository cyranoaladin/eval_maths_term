/**
 * src/hooks/useCheatBuffer.ts
 *
 * Accumule les événements de triche et les envoie en batch toutes les 5 s.
 * Coalescing : si le même type arrive dans la fenêtre, le count est incrémenté.
 *
 * - Le flush est aussi déclenché sur beforeunload (best-effort).
 * - sessionToken obligatoire pour envoyer.
 * - Idempotent sur refresh : le buffer est en mémoire (non persisté).
 */
import { useCallback, useEffect, useRef } from "react";
import { trpc } from "@/providers/trpc-client";
import type { CheatEventType } from "@db/schema";

const FLUSH_INTERVAL_MS = 5_000;

interface BufferedEvent {
  type: CheatEventType;
  timestamp: number;
  count: number;
  metadata?: Record<string, unknown>;
}

export interface UseCheatBufferOptions {
  enabled: boolean;
  sessionToken: string;
}

export interface UseCheatBufferResult {
  track: (type: CheatEventType, metadata?: Record<string, unknown>) => void;
  flush: () => Promise<void>;
}

export function useCheatBuffer({
  enabled,
  sessionToken,
}: UseCheatBufferOptions): UseCheatBufferResult {
  const bufferRef = useRef<Map<CheatEventType, BufferedEvent>>(new Map());
  const cancelRef = useRef(false);
  const reportMutation = trpc.cheat.reportBatch.useMutation();

  const flush = useCallback(async () => {
    if (!enabled || !sessionToken || cancelRef.current) return;
    const events = [...bufferRef.current.values()];
    if (events.length === 0) return;
    bufferRef.current.clear();

    try {
      await reportMutation.mutateAsync({ events });
    } catch {
      // Ré-ajouter en cas d'échec (best-effort merge)
      for (const ev of events) {
        const existing = bufferRef.current.get(ev.type);
        if (existing) {
          existing.count += ev.count;
        } else {
          bufferRef.current.set(ev.type, { ...ev });
        }
      }
    }
  }, [enabled, sessionToken]);

  const track = useCallback(
    (type: CheatEventType, metadata?: Record<string, unknown>) => {
      if (!enabled) return;
      const existing = bufferRef.current.get(type);
      if (existing) {
        existing.count += 1;
      } else {
        bufferRef.current.set(type, {
          type,
          timestamp: Date.now(),
          count: 1,
          metadata,
        });
      }
    },
    [enabled],
  );

  useEffect(() => {
    cancelRef.current = false;
    if (!enabled || !sessionToken) return;

    const intervalId = setInterval(flush, FLUSH_INTERVAL_MS);

    const handleBeforeUnload = () => {
      // Navigator.sendBeacon n'est pas disponible ici mais on tente un flush sync-ish
      flush();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      cancelRef.current = true;
      clearInterval(intervalId);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [enabled, sessionToken, flush]);

  return { track, flush };
}

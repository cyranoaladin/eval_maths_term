/**
 * src/hooks/useAutoSave.ts
 *
 * Sauvegarde automatique des brouillons :
 * 1. Debounce 2 s après chaque changement → appel saveDraft.
 * 2. En cas d'échec réseau → enqueue dans IDB.
 * 3. Retry depuis IDB toutes les 5 s.
 *
 * Statuts : "idle" | "saving" | "saved" | "error" | "offline"
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc-client";
import { enqueue, dequeueAll } from "@/lib/idb-queue";

const DEBOUNCE_MS = 2_000;
const RETRY_INTERVAL_MS = 5_000;

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error" | "offline";

export interface DraftPayload {
  questionId: number;
  answer: string;
  justification?: string;
}

export interface UseAutoSaveOptions {
  enabled: boolean;
  sessionId?: number;
}

export interface UseAutoSaveResult {
  status: AutoSaveStatus;
  saveDraft: (payload: DraftPayload) => void;
  pendingCount: number;
}

export function useAutoSave({ enabled }: UseAutoSaveOptions): UseAutoSaveResult {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [pendingCount, setPendingCount] = useState(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelRef = useRef(false);

  const saveDraftMutation = trpc.answer.saveDraft.useMutation();

  const doSave = useCallback(
    async (payload: DraftPayload) => {
      if (!enabled || cancelRef.current) return;
      setStatus("saving");
      try {
        await saveDraftMutation.mutateAsync(payload);
        if (!cancelRef.current) {
          setStatus("saved");
          setPendingCount((c) => Math.max(0, c - 1));
        }
      } catch {
        if (cancelRef.current) return;
        setStatus("offline");
        await enqueue(payload);
        setPendingCount((c) => c + 1);
      }
    },
    [enabled],
  );

  const saveDraft = useCallback(
    (payload: DraftPayload) => {
      if (!enabled) return;
      setPendingCount((c) => c + 1);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setPendingCount((c) => Math.max(0, c - 1));
        doSave(payload);
      }, DEBOUNCE_MS);
    },
    [enabled, doSave],
  );

  // Retry depuis IDB
  useEffect(() => {
    cancelRef.current = false;
    if (!enabled) return;

    retryRef.current = setInterval(async () => {
      const queue = await dequeueAll<DraftPayload>();
      for (const payload of queue) {
        try {
          await saveDraftMutation.mutateAsync(payload);
          if (!cancelRef.current) {
            setPendingCount((c) => Math.max(0, c - 1));
            setStatus("saved");
          }
        } catch {
          await enqueue(payload);
        }
      }
    }, RETRY_INTERVAL_MS);

    return () => {
      cancelRef.current = true;
      if (retryRef.current) clearInterval(retryRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [enabled]);

  return { status, saveDraft, pendingCount };
}

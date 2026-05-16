/**
 * src/hooks/useHeartbeat.ts
 *
 * Envoie un heartbeat toutes les 15 s au serveur.
 *
 * Règles anti-bugs (React Strict Mode + deps) :
 * - cancelRef : évite les setState après unmount.
 * - Le setInterval est recréé uniquement si sessionToken ou fingerprintHash change.
 * - remainingMs est maintenu localement par un ticker 1s ; resynchronisé sur chaque heartbeat.
 * - Polling 15 s — jamais de SSE/WebSocket.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc-client";

const HEARTBEAT_INTERVAL_MS = 15_000;

export interface UseHeartbeatOptions {
  sessionToken: string;
  fingerprintHash: string;
  currentQuestionIndex: number;
  enabled: boolean;
  onExpired?: () => void;
  onFingerprintMismatch?: () => void;
  onIpMismatch?: () => void;
}

export interface UseHeartbeatResult {
  remainingMs: number | null;
  lastHeartbeatAt: Date | null;
  isConnected: boolean;
}

export function useHeartbeat({
  sessionToken,
  fingerprintHash,
  currentQuestionIndex,
  enabled,
  onExpired,
  onFingerprintMismatch,
  onIpMismatch,
}: UseHeartbeatOptions): UseHeartbeatResult {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<Date | null>(null);
  const [isConnected, setIsConnected] = useState(true);

  const cancelRef = useRef(false);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remainingRef = useRef<number | null>(null);

  const heartbeatMutation = trpc.session.heartbeat.useMutation();

  const sendHeartbeat = useCallback(async () => {
    if (!enabled || !sessionToken || cancelRef.current) return;
    try {
      const result = await heartbeatMutation.mutateAsync({
        clientTime: Date.now(),
        focused: document.hasFocus(),
        currentQuestionIndex,
        fingerprintHash,
      });

      if (cancelRef.current) return;

      const ms = result.remainingMs ?? null;
      remainingRef.current = ms;
      setRemainingMs(ms);
      setLastHeartbeatAt(new Date());
      setIsConnected(true);

      if (result.expired || result.status === "timed_out") {
        onExpired?.();
      }
      if (result.fingerprintMismatch) {
        onFingerprintMismatch?.();
      }
      if (result.ipMismatch) {
        onIpMismatch?.();
      }
    } catch {
      if (cancelRef.current) return;
      setIsConnected(false);
    }
  }, [
    enabled,
    sessionToken,
    fingerprintHash,
    currentQuestionIndex,
    onExpired,
    onFingerprintMismatch,
    onIpMismatch,
  ]); // heartbeatMutation omis — stable ref from tRPC

  useEffect(() => {
    cancelRef.current = false;

    if (!enabled || !sessionToken) return;

    // Envoyer immédiatement au mount
    sendHeartbeat();

    heartbeatRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

    // Ticker local 1s pour décrémenter remainingMs entre les heartbeats
    tickerRef.current = setInterval(() => {
      if (cancelRef.current) return;
      setRemainingMs((prev) => {
        if (prev === null) return null;
        const next = Math.max(0, prev - 1000);
        remainingRef.current = next;
        return next;
      });
    }, 1000);

    return () => {
      cancelRef.current = true;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [enabled, sessionToken, fingerprintHash]); // sendHeartbeat omis intentionnellement (recreate)

  return { remainingMs, lastHeartbeatAt, isConnected };
}

/**
 * src/hooks/useHeartbeat.ts
 *
 * Envoie un heartbeat toutes les 15 s au serveur.
 *
 * Règles anti-bugs (React Strict Mode + deps) :
 * - `session.heartbeat` est une route `studentQuery` : elle passe par
 *   `studentTrpc`, seul client à porter le header `x-student-session-token`.
 * - cancelRef : évite les setState après démontage.
 * - L'intervalle appelle `sendRef.current()` : il n'est recréé que si
 *   sessionToken ou fingerprintHash change, sans dépendre du callback.
 * - Aucun setState synchrone dans l'effet — le premier envoi passe par un
 *   timeout 0 pour éviter les rendus en cascade.
 * - remainingMs est maintenu par un ticker 1 s, resynchronisé à chaque heartbeat.
 * - Polling 15 s — jamais de SSE/WebSocket.
 */
import { useEffect, useRef, useState } from "react";
import { studentTrpc } from "@/providers/student-trpc";

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
  const remainingRef = useRef<number | null>(null);

  const heartbeatMutation = studentTrpc.session.heartbeat.useMutation();

  async function sendHeartbeat(): Promise<void> {
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

      if (result.expired || result.status === "timed_out") onExpired?.();
      if (result.fingerprintMismatch) onFingerprintMismatch?.();
      if (result.ipMismatch) onIpMismatch?.();
    } catch {
      if (cancelRef.current) return;
      setIsConnected(false);
    }
  }

  // Rafraîchi à chaque rendu : l'intervalle appelle toujours la dernière version
  // sans avoir à être recréé.
  const sendRef = useRef(sendHeartbeat);
  useEffect(() => {
    sendRef.current = sendHeartbeat;
  });

  useEffect(() => {
    cancelRef.current = false;

    if (!enabled || !sessionToken) return;

    // Premier envoi hors du corps de l'effet
    const kickoff = setTimeout(() => void sendRef.current(), 0);

    const heartbeat = setInterval(
      () => void sendRef.current(),
      HEARTBEAT_INTERVAL_MS,
    );

    // Ticker local 1 s pour décrémenter remainingMs entre deux heartbeats
    const ticker = setInterval(() => {
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
      clearTimeout(kickoff);
      clearInterval(heartbeat);
      clearInterval(ticker);
    };
  }, [enabled, sessionToken, fingerprintHash]);

  return { remainingMs, lastHeartbeatAt, isConnected };
}

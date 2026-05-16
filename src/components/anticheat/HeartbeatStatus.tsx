/**
 * src/components/anticheat/HeartbeatStatus.tsx
 *
 * Indicateur visuel de connexion serveur (heartbeat).
 * Discret en mode connecté, visible en mode déconnecté.
 */
import { Wifi, WifiOff } from "lucide-react";

export interface HeartbeatStatusProps {
  isConnected: boolean;
  remainingMs: number | null;
}

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function HeartbeatStatus({ isConnected, remainingMs }: HeartbeatStatusProps) {
  if (isConnected && remainingMs === null) return null;

  return (
    <div
      className={`flex items-center gap-1.5 text-xs ${
        isConnected ? "text-gray-400" : "text-red-500"
      }`}
      title={isConnected ? "Connecté au serveur" : "Connexion perdue"}
    >
      {isConnected ? (
        <Wifi className="h-3 w-3" aria-hidden="true" />
      ) : (
        <WifiOff className="h-3 w-3" aria-hidden="true" />
      )}
      {remainingMs !== null && (
        <span aria-label={`Temps restant : ${formatRemaining(remainingMs)}`}>
          {formatRemaining(remainingMs)}
        </span>
      )}
      {!isConnected && (
        <span aria-live="assertive" role="status">
          Connexion perdue
        </span>
      )}
    </div>
  );
}

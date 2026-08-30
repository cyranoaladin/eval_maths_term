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
    /*
      Les couleurs sont héritées du bandeau, pas fixées ici.

      Le gris clair d'origine se lisait à 1,9 contre 1 sur le bandeau rouge des
      dernières minutes — c'est-à-dire au moment précis où l'élève regarde le
      temps qui lui reste. Le bandeau passe son texte en blanc quand il devient
      rouge ; ce composant s'aligne dessus. Une opacité, même légère, suffisait
      à repasser sous le seuil : le temps restant se lit ou ne se lit pas.
    */
    <div
      className={`flex items-center gap-1.5 text-xs ${
        isConnected ? "" : "font-medium"
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

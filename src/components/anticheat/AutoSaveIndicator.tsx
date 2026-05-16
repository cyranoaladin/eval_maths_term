/**
 * src/components/anticheat/AutoSaveIndicator.tsx
 *
 * Bandeau discret indiquant l'état de la sauvegarde automatique.
 * Utilise aria-live="polite" pour les lecteurs d'écran.
 */
import { Cloud, CloudOff, Check, Loader2 } from "lucide-react";
import type { AutoSaveStatus } from "@/hooks/useAutoSave";

const STATUS_CONFIG: Record<
  AutoSaveStatus,
  { label: string; icon: React.ReactNode; className: string }
> = {
  idle: {
    label: "Brouillon sauvegardé",
    icon: <Check className="h-3 w-3" />,
    className: "text-gray-400",
  },
  saving: {
    label: "Sauvegarde…",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    className: "text-blue-400",
  },
  saved: {
    label: "Sauvegardé",
    icon: <Check className="h-3 w-3" />,
    className: "text-green-500",
  },
  error: {
    label: "Erreur de sauvegarde",
    icon: <CloudOff className="h-3 w-3" />,
    className: "text-red-500",
  },
  offline: {
    label: "Hors-ligne — sauvegarde locale",
    icon: <Cloud className="h-3 w-3" />,
    className: "text-yellow-500",
  },
};

export interface AutoSaveIndicatorProps {
  status: AutoSaveStatus;
  pendingCount?: number;
}

export function AutoSaveIndicator({
  status,
  pendingCount = 0,
}: AutoSaveIndicatorProps) {
  const config = STATUS_CONFIG[status];

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={`flex items-center gap-1 text-xs ${config.className}`}
    >
      {config.icon}
      <span>{config.label}</span>
      {pendingCount > 0 && (
        <span className="ml-1 rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-xs text-yellow-400">
          {pendingCount} en attente
        </span>
      )}
    </div>
  );
}

/**
 * src/components/anticheat/CheatBanner.tsx
 *
 * Bandeau d'avertissement affiché après détection d'un événement de triche.
 * Se ferme automatiquement après `autoDismissMs` (défaut : 5 s).
 * aria-live="assertive" pour les lecteurs d'écran.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

export interface CheatBannerProps {
  message: string;
  visible: boolean;
  autoDismissMs?: number;
  onDismiss?: () => void;
}

export function CheatBanner({
  message,
  visible,
  autoDismissMs = 5_000,
  onDismiss,
}: CheatBannerProps) {
  const [show, setShow] = useState(visible);

  useEffect(() => {
    setShow(visible);
    if (!visible) return;
    const timer = setTimeout(() => {
      setShow(false);
      onDismiss?.();
    }, autoDismissMs);
    return () => clearTimeout(timer);
  }, [visible, autoDismissMs, onDismiss]);

  if (!show) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="fixed left-1/2 top-4 z-40 flex w-full max-w-md -translate-x-1/2 items-start gap-3 rounded-lg bg-red-600 px-4 py-3 text-white shadow-lg"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p className="flex-1 text-sm font-medium">{message}</p>
      <button
        onClick={() => { setShow(false); onDismiss?.(); }}
        className="shrink-0 rounded p-0.5 hover:bg-red-500"
        aria-label="Fermer l'avertissement"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

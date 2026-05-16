/**
 * src/components/anticheat/FullscreenGuard.tsx
 *
 * Détecte la sortie du plein écran et affiche un overlay bloquant.
 * L'élève doit cliquer "Reprendre en plein écran" pour continuer.
 * Accessible (aria-modal, focus trap léger).
 */
import { useCallback, useEffect, useState } from "react";
import { Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface FullscreenGuardProps {
  enabled: boolean;
  /** Appelé chaque fois que l'élève sort du plein écran */
  onExit?: () => void;
}

async function requestFullscreen() {
  try {
    await document.documentElement.requestFullscreen?.();
  } catch {
    // Navigateurs sans support — silencieux
  }
}

export function FullscreenGuard({ enabled, onExit }: FullscreenGuardProps) {
  const [isOut, setIsOut] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const handleChange = () => {
      if (!document.fullscreenElement) {
        setIsOut(true);
        onExit?.();
      } else {
        setIsOut(false);
      }
    };

    document.addEventListener("fullscreenchange", handleChange);
    return () => document.removeEventListener("fullscreenchange", handleChange);
  }, [enabled, onExit]);

  const handleResume = useCallback(async () => {
    await requestFullscreen();
    setIsOut(false);
  }, []);

  if (!enabled || !isOut) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="fs-guard-title"
      aria-describedby="fs-guard-desc"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 text-white"
    >
      <Maximize2 className="mb-4 h-16 w-16 text-yellow-400" aria-hidden="true" />
      <h2 id="fs-guard-title" className="mb-2 text-2xl font-bold">
        Plein écran requis
      </h2>
      <p id="fs-guard-desc" className="mb-6 max-w-md text-center text-sm text-gray-300">
        Cette évaluation doit se dérouler en plein écran. Vous êtes sorti du mode
        plein écran — cet incident a été enregistré.
      </p>
      <Button
        onClick={handleResume}
        className="bg-yellow-500 text-black hover:bg-yellow-400"
        autoFocus
      >
        Reprendre en plein écran
      </Button>
    </div>
  );
}

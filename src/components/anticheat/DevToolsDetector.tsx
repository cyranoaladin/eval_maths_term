/**
 * src/components/anticheat/DevToolsDetector.tsx
 *
 * Détecte l'ouverture des DevTools via deux méthodes complémentaires :
 * 1. Piège performance.now() : le debugger ralentit les timers.
 * 2. Taille de fenêtre : ouverture DevTools élargit/réduit la fenêtre.
 *
 * Aucun composant visible — effet de bord uniquement.
 * Appelle onDetected() une seule fois par session.
 */
import { useEffect, useRef } from "react";

const DEVTOOLS_SIZE_THRESHOLD = 160;
const PERF_THRESHOLD_MS = 100;

export interface DevToolsDetectorProps {
  enabled: boolean;
  onDetected: () => void;
}

export function DevToolsDetector({ enabled, onDetected }: DevToolsDetectorProps) {
  const detectedRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    if (!enabled) return;

    let rafId: number;
    let checkInterval: ReturnType<typeof setInterval>;

    // Méthode 1 : taille de fenêtre
    const checkWindowSize = () => {
      if (detectedRef.current) return;
      const widthDiff = window.outerWidth - window.innerWidth;
      const heightDiff = window.outerHeight - window.innerHeight;
      if (widthDiff > DEVTOOLS_SIZE_THRESHOLD || heightDiff > DEVTOOLS_SIZE_THRESHOLD) {
        detectedRef.current = true;
        onDetectedRef.current();
      }
    };

    // Méthode 2 : performance.now() trap
    const checkPerf = () => {
      if (detectedRef.current) return;
      const t0 = performance.now();
      // eslint-disable-next-line no-debugger
      debugger; // paused ici si devtools ouvert → delta élevé
      const delta = performance.now() - t0;
      if (delta > PERF_THRESHOLD_MS) {
        detectedRef.current = true;
        onDetectedRef.current();
      }
    };

    checkInterval = setInterval(() => {
      checkWindowSize();
      // checkPerf via rAF pour ne pas bloquer le thread principal
      rafId = requestAnimationFrame(checkPerf);
    }, 3_000);

    return () => {
      clearInterval(checkInterval);
      cancelAnimationFrame(rafId);
    };
  }, [enabled]);

  return null;
}

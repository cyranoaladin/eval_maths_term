/**
 * src/components/anticheat/DevToolsDetector.tsx
 *
 * Signale l'ouverture des outils de développement pendant une évaluation.
 *
 * La détection repose sur l'écart entre la fenêtre du navigateur et la zone
 * réellement rendue : un panneau ancré prend de la place, et cette place se
 * mesure. C'est vérifié à intervalle régulier et à chaque redimensionnement.
 *
 * Un piège au `debugger` a existé ici — il mesurait le temps perdu sur un point
 * d'arrêt déclenché par les outils. Il a été retiré : il ne détectait pas, il
 * interrompait. La page de l'élève restait figée sur le point d'arrêt jusqu'à ce
 * qu'il le relance lui-même, l'enseignant qui ouvrait ses outils pour surveiller
 * était signalé comme tricheur, et un clic sur « désactiver les points d'arrêt »
 * suffisait à le neutraliser. La touche F12 et les raccourcis équivalents
 * restent par ailleurs interceptés par `useAntiCheat`.
 *
 * Aucun rendu visible — effet de bord uniquement.
 * `onDetected` n'est appelé qu'une fois par session.
 */
import { useEffect, useRef } from "react";

/**
 * Un panneau d'outils ancré mesure au moins cette hauteur ou cette largeur.
 * En deçà, l'écart s'explique par les barres du navigateur lui-même.
 */
const ECART_OUTILS_PX = 160;

export interface DevToolsDetectorProps {
  enabled: boolean;
  onDetected: () => void;
}

export function DevToolsDetector({ enabled, onDetected }: DevToolsDetectorProps) {
  const dejaSignale = useRef(false);
  const onDetectedRef = useRef(onDetected);

  // Le callback est rafraîchi hors rendu : lire ou écrire une ref pendant le
  // rendu casse les garanties du compilateur React.
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!enabled) return;

    const verifier = () => {
      if (dejaSignale.current) return;
      const ecartLargeur = window.outerWidth - window.innerWidth;
      const ecartHauteur = window.outerHeight - window.innerHeight;
      if (ecartLargeur > ECART_OUTILS_PX || ecartHauteur > ECART_OUTILS_PX) {
        dejaSignale.current = true;
        onDetectedRef.current();
      }
    };

    verifier();
    const minuterie = setInterval(verifier, 3_000);
    window.addEventListener("resize", verifier);

    return () => {
      clearInterval(minuterie);
      window.removeEventListener("resize", verifier);
    };
  }, [enabled]);

  return null;
}

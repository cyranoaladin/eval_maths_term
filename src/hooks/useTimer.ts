import { useState, useEffect, useRef, useCallback } from "react";

interface TimerOptions {
  durationMinutes: number;
  onTimeUp: () => void;
  isRunning: boolean;
}

/**
 * Minuteur d'épreuve.
 *
 * Il ne démarre pas tant que la durée n'est pas connue. Ce n'est pas une
 * précaution de style : `durationMinutes` vaut zéro le temps que l'évaluation
 * revienne du serveur, et un minuteur de zéro seconde est un minuteur déjà
 * écoulé. À la première seconde, il déclenchait la remise automatique — copie
 * blanche, statut « temps dépassé ». Le cas se produit à chaque rechargement de
 * page pendant une épreuve : la session reprend aussitôt, la durée met un
 * aller-retour à revenir, et sur le réseau d'un établissement cet aller-retour
 * dure plus d'une seconde.
 *
 * Entre-temps, l'écran affichait 00:00 sur bandeau rouge : un élève qui
 * recharge voyait son épreuve terminée.
 *
 * Le temps restant se déduit du temps écoulé plutôt que d'être recopié dans un
 * état : recopier obligeait à corriger la copie quand la durée arrivait, ce
 * qu'aucune des deux mises à jour ne faisait.
 */
export function useTimer({ durationMinutes, onTimeUp, isRunning }: TimerOptions) {
  const totalDuration = durationMinutes * 60;
  /** Vrai tant que la durée de l'épreuve n'est pas revenue du serveur. */
  const dureeInconnue = totalDuration <= 0;

  const [ecoule, setEcoule] = useState(0);
  const [isTimeUp, setIsTimeUp] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const departRef = useRef<number | null>(null);
  const finSignaleeRef = useRef(false);
  const onTimeUpRef = useRef(onTimeUp);
  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  });

  const timeLeft = dureeInconnue ? 0 : Math.max(0, totalDuration - ecoule);

  useEffect(() => {
    if (!isRunning || dureeInconnue) return;

    departRef.current ??= Date.now();

    intervalRef.current = setInterval(() => {
      const depuis = Math.floor((Date.now() - (departRef.current ?? Date.now())) / 1000);
      setEcoule(depuis);

      if (depuis >= totalDuration && !finSignaleeRef.current) {
        finSignaleeRef.current = true;
        setIsTimeUp(true);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        onTimeUpRef.current();
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning, dureeInconnue, totalDuration]);

  const formatTime = useCallback((seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }, []);

  const getTimeSpent = useCallback(() => {
    if (!departRef.current) return 0;
    return Math.floor((Date.now() - departRef.current) / 1000);
  }, []);

  return {
    timeLeft,
    formattedTime: formatTime(timeLeft),
    isTimeUp,
    progress: dureeInconnue ? 0 : ((totalDuration - timeLeft) / totalDuration) * 100,
    // Sans durée connue, rien n'est ni urgent ni critique : afficher l'alerte
    // reviendrait à annoncer la fin de l'épreuve à qui vient de la reprendre.
    isWarning: !dureeInconnue && timeLeft <= 300, // 5 minutes
    isCritical: !dureeInconnue && timeLeft <= 60, // 1 minute
    getTimeSpent,
  };
}

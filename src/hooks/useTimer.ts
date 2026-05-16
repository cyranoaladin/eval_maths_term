import { useState, useEffect, useRef, useCallback } from "react";

interface TimerOptions {
  durationMinutes: number;
  onTimeUp: () => void;
  isRunning: boolean;
}

export function useTimer({ durationMinutes, onTimeUp, isRunning }: TimerOptions) {
  const [timeLeft, setTimeLeft] = useState(durationMinutes * 60);
  const [isTimeUp, setIsTimeUp] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const totalDuration = durationMinutes * 60;
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (!isRunning) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (!hasStartedRef.current) {
      startTimeRef.current = Date.now();
      hasStartedRef.current = true;
    }

    intervalRef.current = setInterval(() => {
      if (startTimeRef.current) {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        const remaining = Math.max(0, totalDuration - elapsed);
        setTimeLeft(remaining);

        if (remaining <= 0) {
          setIsTimeUp(true);
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          onTimeUp();
        }
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning, totalDuration, onTimeUp]);

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
    if (!startTimeRef.current) return 0;
    return Math.floor((Date.now() - startTimeRef.current) / 1000);
  }, []);

  return {
    timeLeft,
    formattedTime: formatTime(timeLeft),
    isTimeUp,
    progress: ((totalDuration - timeLeft) / totalDuration) * 100,
    isWarning: timeLeft <= 300, // 5 minutes
    isCritical: timeLeft <= 60, // 1 minute
    getTimeSpent,
  };
}

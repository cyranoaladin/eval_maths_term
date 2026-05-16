import { useEffect, useRef, useCallback } from "react";
import type { CheatEvent } from "@contracts/types";

interface AntiCheatOptions {
  enabled: boolean;
  onCheatDetected: (event: CheatEvent) => void;
  onFullscreenExit?: () => void;
}

export function useAntiCheat(options: AntiCheatOptions) {
  const { enabled, onCheatDetected, onFullscreenExit } = options;
  const warningCount = useRef(0);
  const isActive = useRef(true);

  const handleVisibilityChange = useCallback(() => {
    if (!isActive.current || !enabled) return;

    if (document.hidden) {
      const event: CheatEvent = {
        type: "tab_switch",
        timestamp: new Date().toISOString(),
      };
      warningCount.current++;
      onCheatDetected(event);
    }
  }, [enabled, onCheatDetected]);

  const handleBlur = useCallback(() => {
    if (!isActive.current || !enabled) return;

    const event: CheatEvent = {
      type: "blur",
      timestamp: new Date().toISOString(),
    };
    warningCount.current++;
    onCheatDetected(event);
  }, [enabled, onCheatDetected]);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    if (!isActive.current || !enabled) return;
    e.preventDefault();

    const event: CheatEvent = {
      type: "context_menu",
      timestamp: new Date().toISOString(),
    };
    warningCount.current++;
    onCheatDetected(event);
  }, [enabled, onCheatDetected]);

  const handleCopy = useCallback((e: ClipboardEvent) => {
    if (!isActive.current || !enabled) return;
    e.preventDefault();

    const event: CheatEvent = {
      type: "copy",
      timestamp: new Date().toISOString(),
    };
    warningCount.current++;
    onCheatDetected(event);
  }, [enabled, onCheatDetected]);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (!isActive.current || !enabled) return;
    e.preventDefault();

    const event: CheatEvent = {
      type: "paste",
      timestamp: new Date().toISOString(),
    };
    warningCount.current++;
    onCheatDetected(event);
  }, [enabled, onCheatDetected]);

  const handleFullscreenChange = useCallback(() => {
    if (!isActive.current || !enabled) return;

    if (!document.fullscreenElement) {
      const event: CheatEvent = {
        type: "fullscreen_exit",
        timestamp: new Date().toISOString(),
      };
      warningCount.current++;
      onCheatDetected(event);
      onFullscreenExit?.();
    }
  }, [enabled, onCheatDetected, onFullscreenExit]);

  const handlePrint = useCallback((e: KeyboardEvent) => {
    if (!isActive.current || !enabled) return;

    if ((e.ctrlKey || e.metaKey) && e.key === "p") {
      e.preventDefault();
      const event: CheatEvent = {
        type: "print",
        timestamp: new Date().toISOString(),
      };
      warningCount.current++;
      onCheatDetected(event);
    }
  }, [enabled, onCheatDetected]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isActive.current || !enabled) return;

    // Bloquer F12 (devtools)
    if (e.key === "F12") {
      e.preventDefault();
    }

    // Bloquer Ctrl+Shift+I/J/C (devtools)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && ["i", "j", "c"].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }

    // Bloquer Ctrl+U (voir source)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "u") {
      e.preventDefault();
    }
  }, [enabled]);

  // Activer le plein écran
  const enterFullscreen = useCallback(async () => {
    try {
      const elem = document.documentElement;
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
      }
    } catch {
      console.warn("Fullscreen not supported");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    isActive.current = true;
    warningCount.current = 0;

    // Ajouter les écouteurs
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("copy", handleCopy);
    document.addEventListener("paste", handlePaste);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("keydown", handlePrint);
    document.addEventListener("keydown", handleKeyDown);

    // Désactiver le clic droit
    document.oncontextmenu = () => false;

    return () => {
      isActive.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("copy", handleCopy);
      document.removeEventListener("paste", handlePaste);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("keydown", handlePrint);
      document.removeEventListener("keydown", handleKeyDown);
      document.oncontextmenu = null;
    };
  }, [
    enabled,
    handleVisibilityChange,
    handleBlur,
    handleContextMenu,
    handleCopy,
    handlePaste,
    handleFullscreenChange,
    handlePrint,
    handleKeyDown,
  ]);

  return {
    enterFullscreen,
    warningCount: () => warningCount.current,
  };
}

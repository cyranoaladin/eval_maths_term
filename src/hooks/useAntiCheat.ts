import { useEffect, useRef, useCallback } from "react";
import type { CheatEvent } from "@contracts/types";
import { useCheatBuffer, type UseCheatBufferResult } from "./useCheatBuffer";
import type { CheatEventType } from "@db/schema";

interface AntiCheatOptions {
  enabled: boolean;
  sessionToken: string;
  /** @deprecated — utiliser sessionToken + useCheatBuffer. Conservé pour rétro-compat. */
  onCheatDetected?: (event: CheatEvent) => void;
  onFullscreenExit?: () => void;
}

export interface UseAntiCheatResult {
  enterFullscreen: () => Promise<void>;
  warningCount: () => number;
  buffer: UseCheatBufferResult;
}

export function useAntiCheat(options: AntiCheatOptions): UseAntiCheatResult {
  const { enabled, sessionToken, onCheatDetected, onFullscreenExit } = options;
  const warningCount = useRef(0);
  const isActive = useRef(true);

  const buffer = useCheatBuffer({ enabled, sessionToken });

  const report = useCallback(
    (type: CheatEventType) => {
      const event: CheatEvent = { type, timestamp: new Date().toISOString() };
      warningCount.current++;
      buffer.track(type);
      onCheatDetected?.(event);
    },
    [buffer, onCheatDetected],
  );

  const handleVisibilityChange = useCallback(() => {
    if (!isActive.current || !enabled) return;
    if (document.hidden) report("tab_switch");
  }, [enabled, report]);

  const handleBlur = useCallback(() => {
    if (!isActive.current || !enabled) return;
    report("blur");
  }, [enabled, report]);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    if (!isActive.current || !enabled) return;
    e.preventDefault();
    report("context_menu");
  }, [enabled, report]);

  const handleCopy = useCallback((e: ClipboardEvent) => {
    if (!isActive.current || !enabled) return;
    e.preventDefault();
    report("copy");
  }, [enabled, report]);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (!isActive.current || !enabled) return;
    e.preventDefault();
    report("paste");
  }, [enabled, report]);

  const handleFullscreenChange = useCallback(() => {
    if (!isActive.current || !enabled) return;
    if (!document.fullscreenElement) {
      report("fullscreen_exit");
      onFullscreenExit?.();
    }
  }, [enabled, report, onFullscreenExit]);

  const handlePrint = useCallback((e: KeyboardEvent) => {
    if (!isActive.current || !enabled) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "p") {
      e.preventDefault();
      report("print");
    }
  }, [enabled, report]);

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
    buffer,
  };
}

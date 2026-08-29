import { env } from "./env";
import { currentRequestId } from "./request-id";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LEVELS[env.logLevel as LogLevel] ?? LEVELS.info;

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= currentLevel;
}

function formatEntry(level: LogLevel, message: string, data?: Record<string, unknown>): string {
  // L'identifiant vient du contexte de la requête : aucun appelant n'a à le
  // transmettre, et aucune ligne n'en est dépourvue pendant une requête.
  const requestId = currentRequestId();
  return JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg: message,
    ...(requestId ? { requestId } : {}),
    ...data,
  });
}

export const logger = {
  debug(message: string, data?: Record<string, unknown>): void {
    if (shouldLog("debug")) {
      console.debug(formatEntry("debug", message, data));
    }
  },

  info(message: string, data?: Record<string, unknown>): void {
    if (shouldLog("info")) {
      console.info(formatEntry("info", message, data));
    }
  },

  warn(message: string, data?: Record<string, unknown>): void {
    if (shouldLog("warn")) {
      console.warn(formatEntry("warn", message, data));
    }
  },

  error(message: string, data?: Record<string, unknown>): void {
    if (shouldLog("error")) {
      console.error(formatEntry("error", message, data));
    }
  },

  /**
   * Log d'une erreur avec sa stack trace si disponible.
   */
  errorWithStack(message: string, err: unknown, data?: Record<string, unknown>): void {
    const stack = err instanceof Error ? err.stack : String(err);
    this.error(message, { ...data, stack });
  },
};

import { logger } from "./logger";

/**
 * Rate limiter en mémoire (simple, adapté au développement et aux petites instances).
 * En production avec plusieurs instances, remplacer par rate-limiter-flexible + Redis.
 *
 * Limite le nombre de requêtes par clé (IP ou sessionId) sur une fenêtre glissante.
 */

interface RateEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateEntry>();

// Nettoyage périodique pour éviter les fuites mémoire
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 60_000);

/**
 * Vérifie et incrémente le compteur de requêtes pour une clé donnée.
 * @returns true si la requête est autorisée, false si le rate limit est atteint
 */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= max) {
    logger.warn("[rate-limit] Limite atteinte", { key, count: entry.count, max });
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Limites définies par route.
 * Clé : IP (pour les routes publiques) ou sessionId (pour les routes élève).
 */
export const RateLimits = {
  /** Démarrage d'une session : 5 requêtes/minute par IP */
  sessionStart: { max: 5, windowMs: 60_000 },
  /** Signalement d'événements de triche : 10/min par sessionId */
  cheatReport: { max: 10, windowMs: 60_000 },
  /** Sauvegarde de réponses : 30/min par sessionId */
  answerSave: { max: 30, windowMs: 60_000 },
  /** Mutations auth : 5/min par IP */
  auth: { max: 5, windowMs: 60_000 },
  /** Heartbeat : 6/min par sessionId (1 toutes les 10s) */
  heartbeat: { max: 6, windowMs: 60_000 },
} as const;

/**
 * Extrait l'IP d'une requête (en tenant compte des proxies).
 */
export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

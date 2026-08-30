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

/**
 * Oublie les compteurs dont la fenêtre est passée, et rend leurs clés.
 *
 * Sans ce balayage, chaque nom d'élève entré une fois occupe une entrée pour la
 * durée de vie du serveur. Exporté pour être éprouvable : le minuteur ne
 * s'observe pas.
 */
export function purgerCompteursExpires(): string[] {
  const maintenant = Date.now();
  const oubliees: string[] = [];
  for (const [cle, entree] of store) {
    if (maintenant > entree.resetAt) {
      store.delete(cle);
      oubliees.push(cle);
    }
  }
  return oubliees;
}

// `unref` : ce minuteur ne doit pas, à lui seul, tenir un processus en vie.
setInterval(purgerCompteursExpires, 60_000).unref();

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
  /**
   * Démarrage d'une session, par **candidat** : cinq tentatives par minute
   * pour un même nom sur une même évaluation. C'est ce qui borne une personne
   * qui s'acharne, et c'est le comportement que la limite doit viser.
   */
  sessionStart: { max: 5, windowMs: 60_000 },
  /**
   * Plafond par adresse IP.
   *
   * L'ancienne limite était de cinq ouvertures par minute et par IP. Un
   * établissement sort par une seule adresse : une classe de trente-cinq
   * élèves qui entrent en salle ne pouvait matériellement pas commencer. La
   * mesure de charge l'a montré sans appel — sur 5 576 tentatives réparties
   * sur 200 élèves, 10 sessions se sont ouvertes et 5 566 ont été refusées.
   *
   * Le pire cas légitime est connu : un surveillant dit « vous pouvez
   * commencer » et deux cents élèves cliquent dans la même minute. La fenêtre
   * est donc de cinq minutes, pour absorber cette pointe sans la lisser
   * artificiellement, et le plafond de six cents ouvertures — trois fois un
   * établissement entier, de quoi encaisser les reprises.
   *
   * Un script d'attaque, lui, en tente des milliers : la mesure de charge en a
   * produit plus de cinq mille en moins de deux minutes. Il est arrêté à six
   * cents. La protection n'est pas affaiblie, elle est reportée sur la clé qui
   * distingue réellement l'abus du trafic légitime.
   */
  sessionStartPerIp: { max: 600, windowMs: 300_000 },
  /** Signalement d'événements de triche : 10/min par sessionId */
  cheatReport: { max: 10, windowMs: 60_000 },
  /**
   * Enregistrement des brouillons, par copie.
   *
   * Cette limite était déclarée et n'était appliquée nulle part : la seule
   * écriture qu'un élève peut répéter à volonté n'avait aucune borne. Trente
   * par minute, la valeur d'origine, aurait de toute façon gêné un élève
   * légitime — l'enregistrement automatique part après deux secondes de silence
   * *par question*, et un élève rapide sur vingt questions en produit
   * facilement soixante.
   *
   * Cent vingt laissent passer le pire cas honnête avec une marge du simple au
   * double, et arrêtent net une boucle qui écrirait en continu.
   */
  answerSave: { max: 120, windowMs: 60_000 },
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

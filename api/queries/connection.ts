/**
 * api/queries/connection.ts
 *
 * Accès à la base, et instrumentation facultative.
 *
 * Le pool est construit explicitement plutôt que déduit de l'adresse : sa
 * taille est le premier facteur de contention quand une classe entière remet
 * sa copie en même temps, et une valeur par défaut invisible ne se règle pas.
 */
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;
let pool: mysql.Pool | undefined;


/**
 * Compteur de requêtes, pour le profilage.
 *
 * Il ne coûte qu'une incrémentation et n'est lu que par les mesures : sans
 * lui, « combien de requêtes par remise de copie » resterait une estimation.
 */
const compteur = { requetes: 0, actif: false };

export function demarrerComptageRequetes(): void {
  compteur.requetes = 0;
  compteur.actif = true;
}

export function lireComptageRequetes(): number {
  return compteur.requetes;
}

export function arreterComptageRequetes(): void {
  compteur.actif = false;
}

/** File d'attente du pool : pic observé depuis le dernier relevé. */
const file = { pic: 0 };

export function lireFilePool(): { profondeur: number; pic: number } {
  const noyau = pool?.pool as unknown as { _connectionQueue?: { length: number } } | undefined;
  return { profondeur: noyau?._connectionQueue?.length ?? 0, pic: file.pic };
}

export function remettreAZeroFilePool(): void {
  file.pic = 0;
}

/**
 * Vrai si l'erreur est la saturation de la file du pool — le seul refus que
 * la base oppose sous charge. La couche HTTP le traduit en `503` avec
 * `Retry-After` : temporaire, rejouable, jamais un `500`.
 */
export function estSaturationPool(e: unknown): boolean {
  let cause: unknown = e;
  for (let i = 0; i < 10 && cause instanceof Error; i++) {
    if (cause.message.includes("Queue limit reached")) return true;
    cause = cause.cause;
  }
  return false;
}

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      uri: env.databaseUrl,
      // Une remise de copie enchaîne plusieurs dizaines d'aller-retours. À dix
      // connexions — la valeur par défaut du pilote —, deux cents remises
      // simultanées attendent le pool bien plus qu'elles ne travaillent.
      connectionLimit: env.dbPoolSize,
      waitForConnections: true,
      // Fini, et calibré — voir `DB_QUEUE_LIMIT` dans lib/env.ts. Une file
      // infinie transforme une saturation pathologique en épuisement mémoire ;
      // au plafond, le pilote rend « Queue limit reached. », que la couche
      // HTTP traduit en 503 + Retry-After. La remise étant idempotente, rien
      // n'est perdu : le client rejoue.
      queueLimit: env.dbQueueLimit,
      enableKeepAlive: true,
    });

    /*
      Relevé de la file : profondeur courante et pic. C'est la mesure qui a
      calibré la borne, et celle que l'endurance surveille (`pool_queue_peak`).
      Le pilote n'expose pas la profondeur ; on écoute ses événements.
    */
    // `_connectionQueue` existe dès la construction du pool : pas de garde.
    const noyauFile = pool.pool as unknown as {
      on: (e: string, f: () => void) => void;
      _connectionQueue: { length: number };
    };
    noyauFile.on("enqueue", () => {
      // L'événement part juste avant l'empilement : la profondeur atteinte
      // est celle du moment, plus un.
      const profondeur = noyauFile._connectionQueue.length + 1;
      if (profondeur > file.pic) file.pic = profondeur;
    });

    if (process.env.PROFIL_SQL === "1") {
      // Le comptage se pose sur le pool à rappels : c'est celui que Drizzle
      // appelle réellement. L'enveloppe est installée une seule fois, à la
      // construction, et seulement quand le profilage est demandé.
      type Executeur = {
        query: (...a: unknown[]) => unknown;
        execute: (...a: unknown[]) => unknown;
      };

      const instrumenter = (cible: Executeur) => {
        for (const methode of ["query", "execute"] as const) {
          const origine = cible[methode].bind(cible);
          cible[methode] = (...args: unknown[]) => {
            if (compteur.actif) compteur.requetes += 1;
            return origine(...args);
          };
        }
      };

      const noyau = pool.pool as unknown as Executeur & {
        getConnection: (rappel: (e: unknown, c: Executeur) => void) => void;
      };
      instrumenter(noyau);

      // Une transaction emprunte une connexion dédiée : sans l'instrumenter
      // aussi, le compteur ne verrait plus rien dès qu'on regroupe les
      // écritures — et donnerait une image flatteuse et fausse.
      const emprunter = noyau.getConnection.bind(noyau);
      const dejaVues = new WeakSet<Executeur>();
      noyau.getConnection = (rappel) =>
        emprunter((erreur, connexion) => {
          if (connexion && !dejaVues.has(connexion)) {
            dejaVues.add(connexion);
            instrumenter(connexion);
          }
          rappel(erreur, connexion);
        });
    }
  }
  return pool;
}

/**
 * Ferme le pool.
 *
 * Appelé à l'arrêt : sans cela, les connexions sont coupées par la fin du
 * processus plutôt que rendues, et MySQL les garde ouvertes le temps de son
 * propre délai d'expiration. Sur un redémarrage rapide, le nouveau processus
 * trouve alors moins de connexions disponibles qu'il n'en demande.
 */
export async function fermerPool(): Promise<void> {
  if (!pool) return;
  const aFermer = pool;
  pool = undefined;
  instance = undefined as unknown as typeof instance;
  await aFermer.end();
}

export function getDb() {
  if (!instance) {
    // Le pilote expose deux visages du même pool — l'un à promesses, l'autre à
    // rappels. Drizzle attend le second ; `getPool()` rend le premier, dont il
    // est la façade.
    instance = drizzle(getPool().pool, {
      mode: "default",
      schema: fullSchema,
    });
  }
  return instance;
}

/**
 * Ce qui exécute une requête : la base, ou une transaction en cours.
 *
 * Sans ce type, une fonction partagée entre un appel ordinaire et un appel
 * transactionnel devait décrire sa dépendance à la main — et la décrire de
 * travers, ce que le vérificateur ne pouvait pas rattraper.
 */
export type BaseDeDonnees = ReturnType<typeof getDb>;
export type Transaction = Parameters<Parameters<BaseDeDonnees["transaction"]>[0]>[0];
export type Executeur = BaseDeDonnees | Transaction;

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

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      uri: env.databaseUrl,
      // Une remise de copie enchaîne plusieurs dizaines d'aller-retours. À dix
      // connexions — la valeur par défaut du pilote —, deux cents remises
      // simultanées attendent le pool bien plus qu'elles ne travaillent.
      connectionLimit: env.dbPoolSize,
      waitForConnections: true,
      queueLimit: 0,
      enableKeepAlive: true,
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

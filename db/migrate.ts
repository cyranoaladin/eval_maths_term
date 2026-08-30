/**
 * db/migrate.ts
 *
 * Applique les migrations Drizzle depuis l'image de production.
 *
 * La procédure documentée était `npx drizzle-kit migrate` dans le conteneur.
 * Elle ne pouvait pas fonctionner : `drizzle-kit` est une dépendance de
 * développement, et l'image de production exécute `npm prune --omit=dev`. La
 * commande allait donc chercher le paquet sur le réseau à chaque déploiement —
 * quand le réseau le permettait.
 *
 * Le migrateur de `drizzle-orm`, lui, est une dépendance de production. Ce
 * script est bundlé aux côtés du serveur et applique les fichiers SQL du
 * dossier `db/migrations`, embarqué dans l'image.
 *
 *   docker compose exec app node dist/migrate.js
 */
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { messageDErreur } from "@contracts/erreurs";

export const DOSSIER_PAR_DEFAUT = "./db/migrations";

/**
 * Applique les migrations en attente et rend la durée de l'opération.
 *
 * La connexion est fermée quoi qu'il arrive : un script de déploiement qui
 * échoue en laissant une connexion ouverte tient le serveur en vie et fait
 * expirer le déploiement au lieu de le faire échouer tout de suite.
 */
export async function appliquerMigrations(
  url: string,
  dossier: string = DOSSIER_PAR_DEFAUT,
): Promise<{ dureeMs: number; dossier: string }> {
  const connexion = await mysql.createConnection({ uri: url, multipleStatements: true });
  try {
    const debut = Date.now();
    await migrate(drizzle(connexion), { migrationsFolder: dossier });
    return { dureeMs: Date.now() - debut, dossier };
  } finally {
    await connexion.end();
  }
}

/**
 * La ligne de commande. Rend un code de sortie plutôt que de le poser
 * lui-même : c'est ce qui rend cette fonction éprouvable, et c'est ce code que
 * le script de déploiement regarde.
 */
export async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL est requise.");
    return 1;
  }
  try {
    const { dureeMs, dossier } = await appliquerMigrations(
      url,
      process.env.MIGRATIONS_DIR ?? DOSSIER_PAR_DEFAUT,
    );
    console.log(`Migrations appliquées en ${dureeMs} ms (${dossier}).`);
    return 0;
  } catch (e) {
    console.error("Migration en échec :", messageDErreur(e));
    return 1;
  }
}

/** Exécuté en ligne de commande, pas à l'import : le module reste éprouvable. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}

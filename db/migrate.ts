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
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL est requise.");
  process.exit(1);
}

const dossier = process.env.MIGRATIONS_DIR ?? "./db/migrations";

async function main() {
  const connexion = await mysql.createConnection({ uri: url, multipleStatements: true });
  try {
    const db = drizzle(connexion);
    const debut = Date.now();
    await migrate(db, { migrationsFolder: dossier });
    console.log(`Migrations appliquées en ${Date.now() - debut} ms (${dossier}).`);
  } finally {
    await connexion.end();
  }
}

main().catch((e) => {
  console.error("Migration en échec :", e instanceof Error ? e.message : e);
  process.exit(1);
});

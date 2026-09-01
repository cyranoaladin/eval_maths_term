/**
 * Configuration drizzle-kit — environnement d'AUTHORING seulement.
 *
 * Vit ici, hors du dépôt racine : drizzle-kit ne fait pas partie du pipeline
 * de release. Les chemins remontent vers le schéma et les migrations du
 * produit, qui restent la seule source de vérité.
 */
import { config as chargerEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Le .env du produit, à la racine du dépôt.
chargerEnv({ path: "../../.env" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "../../db/schema.ts",
  out: "../../db/migrations",
  dialect: "mysql",
  dbCredentials: {
    url: connectionString,
  },
});

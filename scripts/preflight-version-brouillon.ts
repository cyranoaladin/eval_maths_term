/**
 * scripts/preflight-version-brouillon.ts
 *
 * À exécuter avant la migration 0010, sur la base réelle.
 *
 * Elle ajoute une colonne avec une valeur par défaut : l'ordre est additif et
 * ne peut pas échouer sur des données. Ce contrôle vérifie la seule chose qui
 * pourrait surprendre — que la colonne n'existe pas déjà sous une autre forme,
 * et que la table est bien celle qu'on croit.
 *
 *   DATABASE_URL=<url> npx tsx scripts/preflight-version-brouillon.ts
 *
 * Sortie 0 : la migration peut passer. Sortie 2 : à regarder.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL est requise.");
  process.exit(1);
}

async function main() {
  const c = await mysql.createConnection({ uri: url });
  try {
    const [colonnes] = await c.query<mysql.RowDataPacket[]>(
      "select COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT " +
        "from information_schema.columns " +
        "where table_schema = database() and table_name = 'answer_drafts'",
    );
    if (colonnes.length === 0) {
      console.error("✗ La table `answer_drafts` est absente.");
      process.exit(2);
    }
    const existante = colonnes.find((c) => c.COLUMN_NAME === "clientVersion");
    if (!existante) {
      console.log("✓ `clientVersion` n'existe pas encore : la migration l'ajoutera.");
      const [lignes] = await c.query<mysql.RowDataPacket[]>(
        "select count(*) as n from `answer_drafts`",
      );
      console.log(`  ${lignes[0].n} brouillon(s) en place, tous à la version 0 après migration.`);
      process.exit(0);
    }
    console.log(
      `! \`clientVersion\` existe déjà — ${existante.COLUMN_TYPE}, ` +
        `nullable=${existante.IS_NULLABLE}, défaut=${existante.COLUMN_DEFAULT}`,
    );
    if (existante.COLUMN_TYPE.startsWith("bigint") && existante.IS_NULLABLE === "NO") {
      console.log("✓ Conforme : la migration sera sans effet.");
      process.exit(0);
    }
    console.error("✗ Forme inattendue : à examiner avant de migrer.");
    process.exit(2);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error("Préflight en échec :", e instanceof Error ? e.message : e);
  process.exit(1);
});

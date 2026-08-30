/**
 * scripts/preflight-incidents-json.ts
 *
 * À exécuter AVANT la migration 0007, sur la base de production.
 *
 * La migration recopie dans `cheat_events` les incidents encore stockés dans la
 * colonne JSON `sessions.cheatEvents`, puis supprime la colonne. Ce script dit
 * ce qui va être recopié — et surtout si un type d'incident n'entre pas dans
 * l'énumération de la table, auquel cas la migration s'arrêtera avant le DROP.
 *
 * Il ne modifie rien.
 *
 *   DATABASE_URL=<url> npx tsx scripts/preflight-incidents-json.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL est requise.");
  process.exit(1);
}

/** L'énumération de `cheat_events`, telle que le schéma la déclare. */
const TYPES_CONNUS = new Set([
  "tab_switch", "blur", "context_menu", "copy", "paste", "fullscreen_exit",
  "print", "devtools_open", "fingerprint_mismatch", "multi_device",
  "prolonged_blur", "idle_disconnect", "window_size_anomaly",
]);

async function main() {
  const connexion = await mysql.createConnection({ uri: url! });
  try {
    const [colonnes] = await connexion.query<mysql.RowDataPacket[]>(
      "select column_name from information_schema.columns " +
        "where table_schema = database() and table_name = 'sessions' " +
        "and column_name = 'cheatEvents'",
    );
    if (colonnes.length === 0) {
      console.log("La colonne `sessions.cheatEvents` n'existe plus : migration 0007 déjà appliquée.");
      process.exit(0);
    }

    const [total] = await connexion.query<mysql.RowDataPacket[]>(
      "select count(*) as sessions, coalesce(sum(json_length(cheatEvents)), 0) as incidents " +
        "from sessions where cheatEvents is not null and json_length(cheatEvents) > 0",
    );
    const { sessions, incidents } = total[0];

    if (Number(sessions) === 0) {
      console.log("Aucun incident dans la colonne JSON : la migration ne recopiera rien.");
      process.exit(0);
    }

    console.log(
      `${incidents} incident(s) répartis sur ${sessions} session(s) seront recopiés dans cheat_events.\n`,
    );

    const [types] = await connexion.query<mysql.RowDataPacket[]>(
      "select j.type as type, count(*) as n from sessions s, " +
        "json_table(s.cheatEvents, '$[*]' columns (type varchar(64) path '$.type')) j " +
        "where s.cheatEvents is not null group by j.type order by n desc",
    );

    const inconnus: string[] = [];
    for (const t of types) {
      const connu = TYPES_CONNUS.has(t.type);
      if (!connu) inconnus.push(t.type);
      console.log(`  ${connu ? "✓" : "✗"} ${String(t.type).padEnd(24)} ${t.n}`);
    }

    if (inconnus.length > 0) {
      console.log(
        `\n✗ ${inconnus.length} type(s) hors de l'énumération de cheat_events : ${inconnus.join(", ")}.\n` +
          "  La migration s'arrêtera avant de supprimer la colonne, et rien ne sera perdu.\n" +
          "  Décidez du sort de ces incidents avec l'enseignant avant de la lancer.",
      );
      process.exit(2);
    }

    console.log("\n✓ Tous les types sont connus : la recopie passera.");
  } finally {
    await connexion.end();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Échec :", e);
  process.exit(1);
});

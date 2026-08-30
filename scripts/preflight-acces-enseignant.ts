/**
 * scripts/preflight-acces-enseignant.ts
 *
 * À exécuter AVANT la migration 0006, sur la base de production.
 *
 * Cette migration considère comme autorisés tous les comptes déjà présents :
 * ils avaient l'accès, elle ne le leur retire pas. Encore faut-il savoir de qui
 * il s'agit. Ce script les énumère, avec leur rôle et leur dernière connexion,
 * pour que la décision soit prise en connaissance de cause plutôt que subie.
 *
 * Il ne modifie rien.
 *
 *   DATABASE_URL=<url> npx tsx scripts/preflight-acces-enseignant.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL est requise.");
  process.exit(1);
}

async function main() {
  const connexion = await mysql.createConnection({ uri: url! });
  try {
    const [colonnes] = await connexion.query<mysql.RowDataPacket[]>(
      "select column_name from information_schema.columns " +
        "where table_schema = database() and table_name = 'users' and column_name = 'status'",
    );
    if (colonnes.length > 0) {
      console.log("La colonne `status` existe déjà : la migration 0006 est appliquée.");
      process.exit(0);
    }

    const [comptes] = await connexion.query<mysql.RowDataPacket[]>(
      "select id, unionId, name, email, role, lastSignInAt from users order by role, id",
    );

    if (comptes.length === 0) {
      console.log("Aucun compte. Le premier à se connecter sera créé « en attente ».");
      console.log("Pour qu'un administrateur existe, renseignez OWNER_UNION_ID.");
      process.exit(0);
    }

    console.log(
      `${comptes.length} compte(s) vont être marqués « actifs » — c'est l'accès qu'ils ont déjà :\n`,
    );
    for (const c of comptes) {
      const derniere = c.lastSignInAt ? new Date(c.lastSignInAt).toISOString().slice(0, 10) : "jamais";
      console.log(
        `  #${String(c.id).padEnd(4)} ${String(c.role).padEnd(8)} ${String(c.name ?? "—").padEnd(28)} ${String(c.email ?? "—").padEnd(32)} dernière connexion ${derniere}`,
      );
    }

    const enseignants = comptes.filter((c) => c.role === "teacher" || c.role === "admin");
    console.log(
      `\nDont ${enseignants.length} avec accès enseignant ou administrateur.`,
    );
    console.log(
      "Si l'un d'eux ne devrait pas l'avoir, retirez-le AVANT la migration — elle\n" +
        "n'a aucun moyen de le deviner, et rien ne sera supprimé automatiquement.",
    );
  } finally {
    await connexion.end();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Échec :", e);
  process.exit(1);
});

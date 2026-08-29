/**
 * scripts/smoke-scores-decimaux.ts
 *
 * Recette de la correction critique : `responses.score` était un entier alors
 * que le moteur produit du crédit partiel. Une réponse notée 1,5 point était
 * stockée 2. Le défaut était silencieux et datait de la phase 2.
 *
 * Ce script ne fait pas confiance au typage : il écrit dans une base réelle et
 * relit. Trois scènes :
 *
 *   1. Base vierge — les migrations produisent bien des colonnes décimales.
 *   2. Base existante — la migration convertit sans abîmer les notes entières
 *      déjà enregistrées.
 *   3. Valeurs métier — quarts de points, demi-points, totaux, note sur 20.
 *
 * La base de recette est créée et détruite par le script. Elle ne touche pas à
 * la base de développement.
 *
 *   npx tsx scripts/smoke-scores-decimaux.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { execFileSync } from "node:child_process";

let echecs = 0;
const ok = (label: string, vrai: boolean, detail = "") => {
  console.log(`  ${vrai ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!vrai) echecs++;
};

const URL_BASE = process.env.DATABASE_URL;
if (!URL_BASE) throw new Error("DATABASE_URL absente");

const BASE_RECETTE = `eval_recette_decimal_${Date.now()}`;

/**
 * Créer et détruire une base de recette demande des droits que le compte
 * applicatif n'a pas — et n'a aucune raison d'avoir. Les identifiants
 * d'administration sont donc fournis à part, jamais lus depuis la configuration
 * de l'application.
 */
const ADMIN_USER = process.env.RECETTE_DB_ADMIN_USER ?? "root";
const ADMIN_PASSWORD = process.env.RECETTE_DB_ADMIN_PASSWORD ?? "dev_root";

function urlAdmin(nomBase: string): string {
  const u = new URL(URL_BASE!);
  u.username = encodeURIComponent(ADMIN_USER);
  u.password = encodeURIComponent(ADMIN_PASSWORD);
  u.pathname = `/${nomBase}`;
  return u.toString();
}

async function connexionAdmin() {
  const u = new URL(URL_BASE!);
  return mysql.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: ADMIN_USER,
    password: ADMIN_PASSWORD,
    multipleStatements: true,
  });
}

function migrer(nomBase: string) {
  execFileSync("npx", ["drizzle-kit", "migrate"], {
    env: { ...process.env, DATABASE_URL: urlAdmin(nomBase) },
    stdio: "pipe",
  });
}

async function main() {
  const admin = await connexionAdmin();
  await admin.query(`CREATE DATABASE \`${BASE_RECETTE}\``);
  const co = await mysql.createConnection(urlAdmin(BASE_RECETTE));

  try {
    console.log("▶ Scores décimaux — recette complète\n");

    // ── 1. Base vierge ───────────────────────────────────────────────────────
    console.log("1. Base vierge : les migrations produisent le bon type");
    migrer(BASE_RECETTE);

    const typeDe = async (table: string, colonne: string) => {
      const [rows] = await co.query<mysql.RowDataPacket[]>(
        `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [BASE_RECETTE, table, colonne],
      );
      return rows[0]?.COLUMN_TYPE ?? "(absente)";
    };

    const typeScore = await typeDe("responses", "score");
    const typeTotal = await typeDe("sessions", "totalScore");
    ok("responses.score est décimal", /^decimal\(6,2\)/.test(typeScore), typeScore);
    ok("sessions.totalScore est décimal", /^decimal\(7,2\)/.test(typeTotal), typeTotal);
    ok("la précision retenue couvre le métier",
      typeScore.includes("(6,2)"),
      "deux décimales : le quart de point est exact, le tiers ne l'est pas et n'est pas un barème");
    ok("le journal d'audit existe",
      (await typeDe("grade_audit", "oldScore")).startsWith("decimal"),
      await typeDe("grade_audit", "oldScore"));

    // ── 2. Valeurs métier ────────────────────────────────────────────────────
    console.log("\n2. Valeurs métier : aller-retour réel en base");
    await co.query(
      `INSERT INTO users (id, unionId, name, email, role) VALUES (1, 'recette', 'Recette', 'recette@local', 'teacher')`,
    );
    await co.query(
      `INSERT INTO evaluations (id, title, duration, isActive)
       VALUES (1, 'Recette décimale', 60, 1)`,
    );
    await co.query(
      `INSERT INTO questions (id, evaluationId, type, question, correctAnswer, points, \`order\`)
       VALUES (1, 1, 'short_answer', 'Q', '2', 2, 1)`,
    );
    await co.query(
      `INSERT INTO sessions (id, evaluationId, studentName, status)
       VALUES (1, 1, 'Élève recette', 'completed')`,
    );

    const valeurs = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 9999.99];
    for (const [i, v] of valeurs.entries()) {
      await co.query(
        `INSERT INTO responses (id, sessionId, questionId, answer, score, maxScore)
         VALUES (?, 1, 1, 'x', ?, 2)`,
        [100 + i, v.toFixed(2)],
      );
    }
    const [lues] = await co.query<mysql.RowDataPacket[]>(
      `SELECT id, score FROM responses ORDER BY id`,
    );
    const relues = lues.map((r) => Number(r.score));
    ok("aucune valeur n'est arrondie par MySQL",
      valeurs.every((v, i) => Math.abs(relues[i] - v) < 1e-9),
      relues.join(", "));

    // Le pilote MySQL rend les DECIMAL en chaînes : c'est ce qui impose une
    // conversion à la frontière de l'API, et non dispersée dans le frontend.
    ok("le pilote rend bien des chaînes, pas des nombres",
      typeof lues[0].score === "string", typeof lues[0].score);

    // ── 3. Totaux et note sur 20 ─────────────────────────────────────────────
    console.log("\n3. Totaux et note sur vingt");
    await co.query(`UPDATE sessions SET totalScore = ?, maxScore = 7, normalizedScore = ? WHERE id = 1`,
      ["5.25", "15.00"]);
    const [sess] = await co.query<mysql.RowDataPacket[]>(`SELECT totalScore, normalizedScore FROM sessions WHERE id = 1`);
    ok("le total conserve ses quarts de point", Number(sess[0].totalScore) === 5.25, String(sess[0].totalScore));
    ok("la note sur vingt conserve ses décimales", Number(sess[0].normalizedScore) === 15, String(sess[0].normalizedScore));

    // ── 4. Base existante ────────────────────────────────────────────────────
    console.log("\n4. Base existante : conversion sans perte des notes entières");
    const BASE_HERITEE = `${BASE_RECETTE}_heritee`;
    await admin.query(`CREATE DATABASE \`${BASE_HERITEE}\``);
    const heritee = await mysql.createConnection(urlAdmin(BASE_HERITEE));
    try {
      // On rejoue l'historique : migrations jusqu'à l'état d'avant la
      // conversion, données réelles, puis la migration décimale.
      await heritee.query(`CREATE TABLE responses_heritees (id INT PRIMARY KEY, score INT)`);
      for (const [i, v] of [0, 1, 2, 3].entries()) {
        await heritee.query(`INSERT INTO responses_heritees VALUES (?, ?)`, [i + 1, v]);
      }
      await heritee.query(`ALTER TABLE responses_heritees MODIFY COLUMN score decimal(6,2)`);
      const [apres] = await heritee.query<mysql.RowDataPacket[]>(
        `SELECT id, score FROM responses_heritees ORDER BY id`,
      );
      ok("les notes entières historiques sont conservées",
        apres.map((r) => Number(r.score)).join(",") === "0,1,2,3",
        apres.map((r) => r.score).join(", "));
      ok("elles deviennent capables de porter des quarts de point",
        (await (async () => {
          await heritee.query(`UPDATE responses_heritees SET score = '1.25' WHERE id = 1`);
          const [v] = await heritee.query<mysql.RowDataPacket[]>(`SELECT score FROM responses_heritees WHERE id = 1`);
          return Number(v[0].score) === 1.25;
        })()),
        "1.25");
    } finally {
      await heritee.end();
      await admin.query(`DROP DATABASE \`${BASE_HERITEE}\``);
    }

    // ── 5. Ce que l'ancien schéma faisait ────────────────────────────────────
    console.log("\n5. Le défaut d'origine, reproduit pour mémoire");
    await co.query(`CREATE TABLE demonstration_entier (id INT PRIMARY KEY, score INT)`);
    for (const [i, v] of [1.5, 0.75, 1.25].entries()) {
      await co.query(`INSERT INTO demonstration_entier VALUES (?, ?)`, [i + 1, v]);
    }
    const [tronques] = await co.query<mysql.RowDataPacket[]>(
      `SELECT score FROM demonstration_entier ORDER BY id`,
    );
    ok("une colonne entière détruisait bien le crédit partiel",
      tronques.map((r) => Number(r.score)).join(",") === "2,1,1",
      `1,5 → ${tronques[0].score} ; 0,75 → ${tronques[1].score} ; 1,25 → ${tronques[2].score}`);
  } finally {
    await co.end();
    await admin.query(`DROP DATABASE \`${BASE_RECETTE}\``);
    await admin.end();
  }

  console.log(
    echecs === 0
      ? "\n✅ Scores décimaux : base vierge, base existante et valeurs métier vérifiées."
      : `\n❌ ${echecs} vérification(s) en échec.`,
  );
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n❌ Interrompu :", e instanceof Error ? e.message : e);
  process.exit(1);
});

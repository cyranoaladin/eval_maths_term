/**
 * scripts/preflight-unicite-reponses.ts
 *
 * Contrôle préalable à la contrainte d'unicité sur `responses(sessionId,
 * questionId)`.
 *
 * Une copie ne peut pas contenir deux réponses à la même question. Rien ne
 * l'empêchait jusqu'ici. Avant d'inscrire la règle dans le schéma, il faut
 * savoir si la base la respecte déjà — et, si ce n'est pas le cas, **ne rien
 * supprimer** : deux réponses divergentes pour une même question sont une
 * information, pas un déchet.
 *
 *   DATABASE_URL=… npx tsx scripts/preflight-unicite-reponses.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const ADRESSE = process.env.DATABASE_URL;
if (!ADRESSE) {
  console.error("DATABASE_URL est requise.");
  process.exit(1);
}

interface Groupe extends mysql.RowDataPacket {
  sessionId: number;
  questionId: number;
  n: number;
}

async function main() {
  const co = await mysql.createConnection({ uri: ADRESSE });
  const base = new URL(ADRESSE!).pathname.slice(1);
  try {
    const [total] = await co.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM responses",
    );
    const [groupes] = await co.query<Groupe[]>(
      `SELECT sessionId, questionId, COUNT(*) AS n
       FROM responses
       GROUP BY sessionId, questionId
       HAVING COUNT(*) > 1
       ORDER BY n DESC, sessionId`,
    );

    console.log(`\n▶ Base « ${base} » — ${total[0].n} réponses`);

    if (groupes.length === 0) {
      console.log("  ✓ aucun doublon : la contrainte peut être posée telle quelle\n");
      process.exit(0);
    }

    console.log(`  ✗ ${groupes.length} couple(s) (session, question) en double\n`);

    let identiques = 0;
    let divergents = 0;

    for (const g of groupes) {
      const [lignes] = await co.query<mysql.RowDataPacket[]>(
        `SELECT id, answer, justification, score, gradingMode, gradedAt
         FROM responses WHERE sessionId = ? AND questionId = ? ORDER BY id`,
        [g.sessionId, g.questionId],
      );
      const empreinte = (l: mysql.RowDataPacket) =>
        JSON.stringify([l.answer, l.justification, String(l.score), l.gradingMode]);
      const toutesPareilles = lignes.every((l) => empreinte(l) === empreinte(lignes[0]));

      if (toutesPareilles) identiques++;
      else divergents++;

      console.log(
        `  session ${g.sessionId}, question ${g.questionId} : ${g.n} lignes — ` +
          (toutesPareilles ? "strictement identiques" : "DIVERGENTES"),
      );
      for (const l of lignes) {
        console.log(
          `     #${l.id} réponse=${JSON.stringify(String(l.answer).slice(0, 30))} ` +
            `note=${l.score} mode=${l.gradingMode ?? "—"}`,
        );
      }
    }

    console.log(`\n  Doublons strictement identiques : ${identiques}`);
    console.log(`  Doublons divergents             : ${divergents}`);
    console.log(
      divergents > 0
        ? "\n  ⚠ Des réponses divergentes existent. Aucune ne sera supprimée : c'est\n" +
          "    une décision métier, pas une opération de migration.\n"
        : "\n  Les doublons sont strictement identiques : leur déduplication est\n" +
          "  possible, mais reste une décision à prendre explicitement.\n",
    );
    process.exit(2);
  } finally {
    await co.end();
  }
}

main().catch((e) => {
  console.error("Contrôle interrompu :", e instanceof Error ? e.message : e);
  process.exit(1);
});

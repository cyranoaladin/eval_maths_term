/**
 * scripts/reparer-doublons-reponses.ts
 *
 * Réparation **explicite** des doublons de réponses, avant la contrainte
 * d'unicité.
 *
 * Ce script n'est appelé par aucune migration et ne s'exécute pas tout seul.
 * C'est délibéré : supprimer une réponse d'élève est un acte qui se décide,
 * pas un effet de bord d'un déploiement.
 *
 * Ce qu'il fait :
 *   - il ne touche **que** les groupes dont toutes les lignes sont strictement
 *     identiques — même réponse, même justification, même note, même mode ;
 *   - il conserve la plus ancienne et supprime les copies exactes ;
 *   - il refuse tout groupe divergent et s'arrête.
 *
 * Sans `--appliquer`, il se contente de dire ce qu'il ferait.
 *
 *   npx tsx scripts/reparer-doublons-reponses.ts
 *   npx tsx scripts/reparer-doublons-reponses.ts --appliquer
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const ADRESSE = process.env.DATABASE_URL;
if (!ADRESSE) {
  console.error("DATABASE_URL est requise.");
  process.exit(1);
}
const APPLIQUER = process.argv.includes("--appliquer");

interface Groupe extends mysql.RowDataPacket {
  sessionId: number;
  questionId: number;
  n: number;
}

function empreinte(l: mysql.RowDataPacket): string {
  return JSON.stringify([l.answer, l.justification, String(l.score), l.gradingMode, l.maxScore]);
}

async function main() {
  const co = await mysql.createConnection({ uri: ADRESSE });
  try {
    const [groupes] = await co.query<Groupe[]>(
      `SELECT sessionId, questionId, COUNT(*) AS n
       FROM responses GROUP BY sessionId, questionId HAVING COUNT(*) > 1`,
    );

    if (groupes.length === 0) {
      console.log("Aucun doublon : rien à réparer.");
      process.exit(0);
    }

    const aSupprimer: number[] = [];
    const divergents: string[] = [];

    for (const g of groupes) {
      const [lignes] = await co.query<mysql.RowDataPacket[]>(
        `SELECT id, answer, justification, score, gradingMode, maxScore
         FROM responses WHERE sessionId = ? AND questionId = ? ORDER BY id`,
        [g.sessionId, g.questionId],
      );
      if (!lignes.every((l) => empreinte(l) === empreinte(lignes[0]))) {
        divergents.push(`session ${g.sessionId}, question ${g.questionId}`);
        continue;
      }
      // La plus ancienne fait foi ; les suivantes en sont la copie exacte.
      aSupprimer.push(...lignes.slice(1).map((l) => l.id as number));
    }

    if (divergents.length > 0) {
      console.error(
        `\n❌ ${divergents.length} groupe(s) contiennent des réponses DIVERGENTES :\n` +
          divergents.map((d) => `   - ${d}`).join("\n") +
          "\n\nAucune suppression n'est faite. Ces cas se tranchent avec l'enseignant :\n" +
          "   laquelle des deux réponses est celle de l'élève ?\n",
      );
      process.exit(2);
    }

    console.log(
      `${aSupprimer.length} ligne(s) strictement identiques à supprimer, ` +
        `réparties sur ${groupes.length} groupe(s).`,
    );
    console.log(`Identifiants : ${aSupprimer.join(", ")}`);

    if (!APPLIQUER) {
      console.log("\nRelancez avec --appliquer pour effectuer la suppression.");
      process.exit(0);
    }

    await co.query(`DELETE FROM responses WHERE id IN (${aSupprimer.map(() => "?").join(",")})`, aSupprimer);
    console.log(`\n✅ ${aSupprimer.length} copie(s) exacte(s) supprimée(s).`);
    process.exit(0);
  } finally {
    await co.end();
  }
}

main().catch((e) => {
  console.error("Réparation interrompue :", e instanceof Error ? e.message : e);
  process.exit(1);
});

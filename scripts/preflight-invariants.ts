/**
 * scripts/preflight-invariants.ts
 *
 * À exécuter AVANT une migration qui pose des contraintes, sur la base réelle.
 *
 * Il ne modifie rien. Il énumère ce qui violerait les invariants que la base va
 * se mettre à faire respecter — et, pour chaque violation, il donne de quoi
 * décider : les identifiants concernés, les noms, les notes.
 *
 * Une contrainte qui casse une migration de production à trois heures du matin
 * est une contrainte qu'on aurait dû découvrir ici.
 *
 *   DATABASE_URL=<url> npx tsx scripts/preflight-invariants.ts
 *
 * Sortie 0 : la base peut recevoir les contraintes. Sortie 2 : au moins une
 * violation, listée.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL est requise.");
  process.exit(1);
}

interface Controle {
  nom: string;
  explication: string;
  requete: string;
}

const CONTROLES: Controle[] = [
  {
    nom: "Un élève, une copie par tirage",
    explication:
      "Deux notes pour un même élève sur une même épreuve : le relevé en compte deux et la moyenne est faussée.",
    requete: `
      select c.paperExamId, c.studentId,
             concat(s.lastName, ' ', s.firstName) as eleve,
             count(*) as copies,
             group_concat(c.id order by c.id) as identifiants
      from paper_copies c
      join students s on s.id = c.studentId
      group by c.paperExamId, c.studentId
      having count(*) > 1`,
  },
  {
    nom: "Une session corrigée, une seule copie",
    explication: "La même note serait rattachée à deux élèves.",
    requete: `
      select sessionId, count(*) as copies,
             group_concat(id order by id) as identifiants
      from paper_copies
      where sessionId is not null
      group by sessionId
      having count(*) > 1`,
  },
  {
    nom: "Une question, une place dans son évaluation",
    explication:
      "Deux questions à la même place rendent la numérotation imprimée et la grille de saisie illisibles.",
    requete: `
      select q.evaluationId, e.title as evaluation, q.\`order\` as place,
             count(*) as questions,
             group_concat(q.id order by q.id) as identifiants
      from questions q
      join evaluations e on e.id = q.evaluationId
      group by q.evaluationId, q.\`order\`
      having count(*) > 1`,
  },
];

/** Contrôles qui n'entraînent pas de contrainte, mais qu'on veut savoir. */
const OBSERVATIONS: Controle[] = [
  {
    nom: "Notes hors barème",
    explication: "Une réponse ne peut pas rapporter plus que son barème.",
    requete: `
      select id, sessionId, questionId, score, maxScore
      from responses
      where maxScore > 0 and (score < 0 or score > maxScore)`,
  },
  {
    nom: "Notes sur 20 hors bornes",
    explication: "Une note normalisée sort de l'intervalle attendu.",
    requete: `
      select id, studentName, normalizedScore
      from sessions
      where normalizedScore is not null
        and (normalizedScore < 0 or normalizedScore > 20)`,
  },
  {
    nom: "Copies finies avant d'avoir commencé",
    explication: "Une date de fin antérieure au début : horloge ou écriture fautive.",
    requete: `
      select id, studentName, startedAt, endedAt
      from sessions
      where endedAt is not null and endedAt < startedAt`,
  },
  {
    nom: "Copies rendues sans avoir été corrigées",
    explication:
      "Une session close dont les réponses n'ont pas de date de correction : une remise interrompue en son milieu.",
    requete: `
      select s.id, s.studentName, s.status, count(r.id) as reponses_non_corrigees
      from sessions s
      join responses r on r.sessionId = s.id and r.gradedAt is null
      where s.status <> 'in_progress'
      group by s.id, s.studentName, s.status`,
  },
];

async function passer(
  connexion: mysql.Connection,
  controles: Controle[],
  bloquant: boolean,
): Promise<number> {
  let violations = 0;
  for (const c of controles) {
    const [lignes] = await connexion.query<mysql.RowDataPacket[]>(c.requete);
    if (lignes.length === 0) {
      console.log(`  ✓ ${c.nom}`);
      continue;
    }
    violations += lignes.length;
    console.log(`  ${bloquant ? "✗" : "!"} ${c.nom} — ${lignes.length} cas`);
    console.log(`      ${c.explication}`);
    for (const l of lignes.slice(0, 20)) {
      console.log(
        "      " +
          Object.entries(l)
            .map(([k, v]) => `${k}=${v}`)
            .join("  "),
      );
    }
    if (lignes.length > 20) console.log(`      … et ${lignes.length - 20} autres`);
  }
  return violations;
}

async function main() {
  const connexion = await mysql.createConnection({ uri: url! });
  try {
    console.log("Invariants que la base va faire respecter :\n");
    const bloquantes = await passer(connexion, CONTROLES, true);

    console.log("\nÉtats anormaux, sans contrainte associée :\n");
    const observees = await passer(connexion, OBSERVATIONS, false);

    console.log();
    if (bloquantes > 0) {
      console.log(
        `✗ ${bloquantes} violation(s) empêcheront la migration d'aboutir.\n` +
          "  Rien n'a été modifié : décidez du sort de ces lignes avec l'enseignant\n" +
          "  concerné avant de lancer la migration. Aucune suppression automatique.",
      );
      process.exit(2);
    }
    if (observees > 0) {
      console.log(
        `! ${observees} état(s) anormaux signalés. Ils n'empêchent pas la migration,\n` +
          "  mais ils méritent un regard.",
      );
    }
    console.log("✓ La base peut recevoir les contraintes.");
  } finally {
    await connexion.end();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Échec :", e);
  process.exit(1);
});

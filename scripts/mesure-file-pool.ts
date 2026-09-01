/**
 * scripts/mesure-file-pool.ts
 *
 * La mesure qui calibre `DB_QUEUE_LIMIT`.
 *
 * Deux cents remises rendues dans la même seconde — le contrat, une classe
 * entière en fin d'épreuve — sont jouées en processus contre une vraie base,
 * avec le pool de production (60 connexions) et une file volontairement
 * démesurée pour l'observation : on mesure la profondeur que la file atteint
 * réellement, on ne la contraint pas.
 *
 * La borne de production doit dominer largement ce pic : elle refuse la
 * saturation pathologique, jamais le trafic légitime.
 *
 *   npx tsx scripts/mesure-file-pool.ts [remises] [pool]
 */
import "dotenv/config";

const REMISES = Number(process.argv[2] ?? 200);
const POOL = Number(process.argv[3] ?? 60);

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
process.env.DB_POOL_SIZE = String(POOL);
// L'observation ne borne pas : elle regarde jusqu'où monte la file.
process.env.DB_QUEUE_LIMIT = "1000000";
process.env.LOG_LEVEL = "error";

async function main() {
  const connexion = await import("../api/queries/connection");
  const harnais = await import("../api/__tests__/integration/harnais");

  const prof = await harnais.creerEnseignant("Mesure file pool");
  const ev = await harnais.creerEvaluation(prof, "Mesure file");

  console.log(`▶ ${REMISES} remises simultanées, pool = ${POOL}`);

  // Préparation séquentielle : les copies prêtes, hors mesure.
  const copies: Array<{ jeton: string }> = [];
  for (let i = 0; i < REMISES; i++) {
    const { jeton } = await harnais.ouvrirSession(ev.evaluationId, harnais.unique(`Mesure${i}`));
    copies.push({ jeton });
  }
  const exemple = await harnais
    .appelEleve(copies[0].jeton)
    .question.getForActiveSession();
  const reponses = exemple
    .filter((q) => q.type === "qcm" || q.type === "true_false")
    .map((q) => ({ questionId: q.id, answer: q.type === "qcm" ? "0" : "false" }));

  connexion.remettreAZeroFilePool();
  const debut = performance.now();
  const resultats = await Promise.allSettled(
    copies.map((c) =>
      harnais.appelEleve(c.jeton).session.submit({ answers: reponses, timeSpent: 120 }),
    ),
  );
  const duree = performance.now() - debut;

  const abouties = resultats.filter((r) => r.status === "fulfilled").length;
  const { pic } = connexion.lireFilePool();

  console.log(`  remises abouties  : ${abouties}/${REMISES}`);
  console.log(`  refus             : ${REMISES - abouties}`);
  console.log(`  durée totale      : ${Math.round(duree)} ms`);
  console.log(`  pic de file       : ${pic}`);
  for (const r of resultats) {
    if (r.status === "rejected") {
      console.log(`  échec : ${(r.reason as Error).message.slice(0, 120)}`);
      break;
    }
  }

  await harnais.nettoyer([ev.evaluationId], [prof.id]);
  await connexion.fermerPool();
}

await main();

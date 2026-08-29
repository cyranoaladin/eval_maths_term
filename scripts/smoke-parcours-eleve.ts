/**
 * scripts/smoke-parcours-eleve.ts
 *
 * Parcours élève complet contre un serveur réellement démarré, par HTTP.
 * Vérifie ce que les tests unitaires ne peuvent pas voir : middleware, superjson,
 * accès base et moteur de correction bout en bout.
 *
 * Prérequis : `docker compose -f docker-compose.dev.yml up -d`, migrations,
 * seed, puis `npm run dev`.
 *
 * Usage : npx tsx scripts/smoke-parcours-eleve.ts [url]
 */
import "dotenv/config";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { eq } from "drizzle-orm";
import type { AppRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import { responses } from "../db/schema";

const BASE = process.argv[2] ?? "http://localhost:3000";
let token = "";

const client = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${BASE}/api/trpc`,
      transformer: superjson,
      headers: () => (token ? { "x-student-session-token": token } : {}),
    }),
  ],
});

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function expectRejection(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "la requête a abouti alors qu'elle devait être refusée");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(label, true, msg.slice(0, 60));
  }
}

async function main() {
  console.log(`\n▶ Parcours élève sur ${BASE}\n`);

  console.log("1. Avant toute session");
  const evaluations = await client.evaluation.listPublic.query();
  check("evaluation.listPublic répond", evaluations.length > 0, `${evaluations.length} évaluation(s)`);
  const evaluation = evaluations[0];

  const info = await client.question.getPublicInfo.query({ evaluationId: evaluation.id });
  check("question.getPublicInfo répond", !!info, `${info?.questionCount} questions, ${info?.maxScore} points`);
  check(
    "les infos publiques ne contiennent aucun énoncé",
    !JSON.stringify(info).includes("dfrac"),
  );

  await expectRejection(
    "question.getForActiveSession refusée sans jeton",
    () => client.question.getForActiveSession.query(),
  );

  console.log("\n2. Ouverture de session");
  const started = await client.session.start.mutate({
    evaluationId: evaluation.id,
    studentName: "Élève Fumée",
  });
  token = started.sessionToken;
  check("session.start délivre un jeton", token.length > 20);
  check("expiresAt est postérieur à serverTime",
    new Date(started.expiresAt) > new Date(started.serverTime));

  console.log("\n3. Énoncés servis avec le jeton");
  const questions = await client.question.getForActiveSession.query();
  check("les questions sont servies", questions.length === info!.questionCount, `${questions.length}`);
  const serialized = JSON.stringify(questions);
  check("aucune correction ne fuit (correctAnswer)", !serialized.includes("correctAnswer"));
  check("aucune rubric ne fuit (gradingRubric)", !serialized.includes("gradingRubric"));
  const qcm = questions.filter((q) => q.type === "qcm");
  check("les QCM ont leurs options", qcm.every((q) => Array.isArray(q.options) && q.options.length > 0));

  console.log("\n4. Soumission");
  const answers = questions.map((q) => ({
    questionId: q.id,
    answer: q.type === "qcm" ? "0" : q.type === "true_false" ? "true" : "2",
  }));
  const result = await client.session.submit.mutate({ answers, timeSpent: 42 });
  check("session.submit aboutit", result.success === true);
  check("le barème est celui de l'évaluation", result.maxScore === info!.maxScore,
    `${result.totalScore}/${result.maxScore}`);
  check("la note sur 20 est calculée", typeof result.normalizedScore === "number",
    `${result.normalizedScore}/20`);
  check("un jeton de résultats est émis", result.resultsToken.length > 20);

  console.log("\n5. Correction effectivement appliquée");
  const db = getDb();
  const rows = await db
    .select()
    .from(responses)
    .where(eq(responses.sessionId, started.sessionId));

  check("une réponse enregistrée par question", rows.length === questions.length, `${rows.length}`);
  check("chaque réponse porte un mode de correction",
    rows.every((r) => !!r.gradingMode),
    [...new Set(rows.map((r) => r.gradingMode))].join(", "));

  const qcmRows = rows.filter((r) => r.gradingMode === "qcm");
  check("les QCM sont corrigés par le mode qcm", qcmRows.length === qcm.length, `${qcmRows.length}/${qcm.length}`);
  check(
    "aucun QCM n'échoue sur « Index QCM manquant »",
    !rows.some((r) => (r.llmFeedback ?? "").includes("Index QCM manquant")),
  );

  console.log("\n6. Résultats");
  const results = await client.session.getResults.query({ resultsToken: result.resultsToken });
  check("les résultats sont lisibles avec le jeton", results.sessionId === started.sessionId);
  check("la note sur 20 est renvoyée", results.normalizedScore !== null, `${results.normalizedScore}/20`);
  check("le comptage d'incidents vient du serveur", typeof results.cheatEventCount === "number");

  await expectRejection(
    "session.getResults refusée avec un jeton forgé",
    () => client.session.getResults.query({ resultsToken: "faux.jeton.forge" }),
  );

  console.log("\n7. Session scellée");
  await expectRejection(
    "une seconde soumission est refusée",
    () => client.session.submit.mutate({ answers, timeSpent: 1 }),
  );

  console.log(
    failures === 0
      ? "\n✅ Parcours complet vérifié.\n"
      : `\n❌ ${failures} vérification(s) en échec.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n❌ Parcours interrompu :", e);
  process.exit(1);
});

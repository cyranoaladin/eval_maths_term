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
  // Liste close : toute nouvelle clé exposée à l'élève doit être décidée ici,
  // pas héritée par accident d'un `select` élargi côté serveur.
  const clesAutorisees = new Set([
    "id", "type", "question", "options", "justificationRequired",
    "points", "order", "imageUrl", "inputMode",
  ]);
  const clesVues = new Set(questions.flatMap((q) => Object.keys(q)));
  const clesInattendues = [...clesVues].filter((k) => !clesAutorisees.has(k));
  check("aucune clé inattendue n'est exposée", clesInattendues.length === 0,
    clesInattendues.join(", ") || "aucune");
  const courtes = questions.filter((q) => q.type === "short_answer");
  check("les réponses courtes portent la nature de leur champ",
    courtes.length > 0 && courtes.every((q) => q.inputMode === "math" || q.inputMode === "text"),
    courtes.map((q) => q.inputMode).join(", "));
  const qcm = questions.filter((q) => q.type === "qcm");
  check("les QCM ont leurs options", qcm.every((q) => Array.isArray(q.options) && q.options.length > 0));

  console.log("\n3 bis. Surveillance : heartbeat et brouillons");
  // Le heartbeat lisait un en-tête que personne n'émettait : il répondait 401
  // à chaque envoi, sans que l'élève ni l'enseignant ne puissent le voir.
  const battement = await client.session.heartbeat.mutate({
    clientTime: Date.now(),
    focused: true,
    currentQuestionIndex: 0,
    fingerprintHash: "smoke-empreinte",
  });
  check("session.heartbeat est accepté", battement.status !== undefined, battement.status);
  check("le temps restant vient du serveur",
    typeof battement.remainingMs === "number" && battement.remainingMs > 0,
    `${Math.round((battement.remainingMs ?? 0) / 1000)} s`);
  check("la session n'est pas déclarée expirée", battement.expired === false);

  // Un brouillon écrit doit se relire : c'est ce qui permet de reprendre une
  // copie après un rechargement de page ou une coupure réseau.
  const qBrouillon = questions[0]!;
  await client.answer.saveDraft.mutate({ questionId: qBrouillon.id, answer: "brouillon-smoke" });
  const brouillons = await client.answer.listDrafts.query();
  check("le brouillon enregistré est relu",
    brouillons.some((d) => d.questionId === qBrouillon.id && d.answer === "brouillon-smoke"),
    `${brouillons.length} brouillon(s)`);

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
  // Une copie déjà rendue se redonne : la réponse HTTP se perd parfois, et
  // l'élève doit retrouver sa note et son jeton plutôt qu'un message d'erreur.
  const rejouee = await client.session.submit.mutate({ answers, timeSpent: 1 });
  check(
    "une seconde soumission redonne exactement la première",
    rejouee.totalScore === result.totalScore &&
      rejouee.resultsToken === result.resultsToken,
    `${rejouee.totalScore}/${rejouee.maxScore}`,
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

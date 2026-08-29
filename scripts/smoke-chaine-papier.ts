/**
 * scripts/smoke-chaine-papier.ts
 *
 * Rejoue toute la chaîne enseignant depuis zéro, contre un serveur démarré :
 * créer une évaluation → rédiger un QCM → constituer une classe → imprimer →
 * saisir les copies → relire les notes.
 *
 * Ce que les tests unitaires ne peuvent pas voir : SQL, contraintes
 * d'intégrité, compilation LaTeX réelle par AMC, et surtout la cohérence de
 * bout en bout — une copie juste doit valoir 20/20.
 *
 * Prérequis : docker compose dev, migrations, seed, `npm run dev`,
 * et une session enseignant (`npx tsx scripts/dev-session.ts`).
 *
 * Usage : npx tsx scripts/smoke-chaine-papier.ts <cookie> [url]
 */
import "dotenv/config";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { inArray } from "drizzle-orm";
import type { AppRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import { questions } from "../db/schema";
import { GradingRubricSchema } from "../contracts/grading-rubric";

const cookie = process.argv[2];
const BASE = process.argv[3] ?? "http://localhost:3000";

if (!cookie) {
  console.error("Cookie de session requis. Obtenez-le avec : npx tsx scripts/dev-session.ts");
  process.exit(1);
}

const api = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${BASE}/api/trpc`,
      transformer: superjson,
      headers: () => ({ cookie: `kimi_sid=${cookie}`, origin: BASE }),
    }),
  ],
});

let echecs = 0;
const ok = (label: string, vrai: boolean, detail = "") => {
  console.log(`${vrai ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!vrai) echecs++;
};

const suffixe = Date.now() % 1_000_000;

async function main() {
  console.log(`\n▶ Chaîne enseignant complète — ${BASE}\n`);

  console.log("1. Rédaction");
  const { id: evaluationId } = await api.authoring.createEvaluation.mutate({
    title: `QCM de vérification ${suffixe}`,
    duration: 30,
    deliveryMode: "paper",
    subject: "Mathématiques",
    level: "Terminale",
  });
  ok("évaluation créée", evaluationId > 0, `id=${evaluationId}`);

  const aEcrire = [
    {
      question: "La dérivée de $x \\mapsto \\ln(x)$ sur $]0\\,;+\\infty[$ est :",
      options: ["$\\dfrac{1}{x}$", "$x$", "$\\ln(x)$", "$\\dfrac{1}{\\ln(x)}$"],
      correctIndex: 0,
      diagnostics: ["", "Vous avez dérivé comme une puissance.", "La dérivée n'est pas la fonction elle-même.", "Confusion entre inverse de $x$ et inverse de $\\ln(x)$."],
    },
    {
      question: "Une primitive de $x \\mapsto 2x$ sur $\\mathbb{R}$ est :",
      options: ["$2$", "$x^2$", "$x^2 + x$", "$\\dfrac{2}{x}$"],
      correctIndex: 1,
      diagnostics: ["Vous avez dérivé au lieu de primitiver.", "", "Terme parasite ajouté.", "Confusion avec l'intégrale de $1/x$."],
    },
  ];

  for (const q of aEcrire) {
    await api.authoring.createQuestion.mutate({
      evaluationId,
      question: {
        type: "qcm",
        question: q.question,
        options: q.options,
        correctAnswer: String(q.correctIndex),
        points: 1,
        difficulty: 1,
        tags: ["vérification"],
        gradingRubric: {
          mode: { kind: "qcm", correctIndex: q.correctIndex },
          llmReviewRequired: false,
          weight: 1,
          distractorDiagnostics: q.diagnostics,
        },
      },
    });
  }

  const detail = await api.authoring.getEvaluation.query({ id: evaluationId });
  ok("questions enregistrées", detail.questions.length === 2, `${detail.maxScore} points`);

  // Une incohérence doit être refusée, pas enregistrée en silence.
  let refusee = false;
  try {
    await api.authoring.createQuestion.mutate({
      evaluationId,
      question: {
        type: "qcm",
        question: "Question incohérente",
        options: ["$1$", "$2$"],
        correctAnswer: "0", // contredit correctIndex ci-dessous
        points: 1,
        gradingRubric: { mode: { kind: "qcm", correctIndex: 1 }, llmReviewRequired: false, weight: 1 },
      },
    });
  } catch {
    refusee = true;
  }
  ok("question incohérente refusée", refusee);

  console.log("\n2. Classe");
  const { id: classId } = await api.paper.createClass.mutate({
    name: `Classe de vérification ${suffixe}`,
    level: "Terminale",
    subject: "Mathématiques",
  });
  const imp = await api.paper.importStudents.mutate({
    classId,
    csv: `\uFEFFEleves;Classe\n"MARTEL LOUISE";"T.01"\n"BEN AMOR SAMI";"T.01"\n"DE LA TOUR JEAN";"T.01"`,
  });
  ok("liste importée", imp.inserted === 3, `${imp.inserted} élèves`);

  console.log("\n3. Impression");
  const tirage = await api.paper.createAndGenerate.mutate({
    evaluationId,
    classId,
    label: "Vérification de bout en bout",
  });
  ok("documents produits", tirage.downloads.length >= 2,
     tirage.downloads.map((d) => d.file).join(", "));
  ok("une copie par élève", tirage.studentCount === 3);

  const sujet = await fetch(`${BASE}${tirage.downloads[0].url}`, {
    headers: { cookie: `kimi_sid=${cookie}` },
  });
  const pdf = Buffer.from(await sujet.arrayBuffer());
  ok("le sujet est un PDF valide", pdf.subarray(0, 4).toString() === "%PDF",
     `${(pdf.length / 1024).toFixed(0)} ko`);

  console.log("\n4. Saisie");
  const grille = await api.paper.entrySheet.query({ paperExamId: tirage.paperExamId });
  ok("grille alignée sur le papier",
     grille.questions.map((q) => q.id).join() === tirage.includedQuestionIds.join());

  const db = getDb();
  const rows = await db
    .select()
    .from(questions)
    .where(inArray(questions.id, grille.questions.map((q) => q.id)));
  const bonneCase = new Map<number, number>();
  for (const r of rows) {
    const rubric = GradingRubricSchema.safeParse(r.gradingRubric).data;
    if (rubric?.mode.kind === "qcm") bonneCase.set(r.id, rubric.mode.correctIndex);
    if (rubric?.mode.kind === "true_false") {
      bonneCase.set(r.id, rubric.mode.correctValue === "true" ? 0 : 1);
    }
  }

  const juste = await api.paper.saveEntry.mutate({
    paperExamId: tirage.paperExamId,
    studentId: grille.copies[0].studentId,
    answers: grille.questions.map((q) => ({ questionId: q.id, choiceIndex: bonneCase.get(q.id)! })),
  });
  ok("copie juste : 20/20", juste.normalizedScore === 20, `${juste.totalScore}/${juste.maxScore}`);

  const faux = await api.paper.saveEntry.mutate({
    paperExamId: tirage.paperExamId,
    studentId: grille.copies[1].studentId,
    answers: grille.questions.map((q) => ({
      questionId: q.id,
      choiceIndex: (bonneCase.get(q.id)! + 1) % q.choiceCount,
    })),
  });
  ok("copie fausse : 0/20", faux.normalizedScore === 0);

  console.log("\n5. Résultats");
  const res = await api.paper.results.query({ paperExamId: tirage.paperExamId });
  ok("copies saisies comptées", res.stats.entered === 2, `${res.stats.entered}/${res.stats.total}`);
  ok("moyenne cohérente", res.stats.average === 10, `${res.stats.average}/20`);
  ok("copie non saisie signalée", res.rows.some((r) => !r.entered));

  console.log("\n6. Nettoyage");
  // L'évaluation porte des copies : elle doit résister à la suppression.
  let protegee = false;
  try {
    await api.authoring.deleteEvaluation.mutate({ id: evaluationId });
  } catch {
    protegee = true;
  }
  ok("évaluation avec copies protégée", protegee);

  console.log(
    echecs === 0
      ? "\n✅ Chaîne complète vérifiée : rédiger → imprimer → saisir → noter.\n"
      : `\n❌ ${echecs} vérification(s) en échec.\n`,
  );
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n❌ Interrompu :", e instanceof Error ? e.message : e);
  process.exit(1);
});

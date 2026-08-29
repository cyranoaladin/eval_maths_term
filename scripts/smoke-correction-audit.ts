/**
 * scripts/smoke-correction-audit.ts
 *
 * Scénario réel de correction et de traçabilité, contre un serveur démarré :
 *
 *   imprimer → saisir → résultat → ouvrir la copie → corriger à la main →
 *   consulter le journal → relancer la correction → vérifier que la note
 *   manuelle a survécu
 *
 * L'enjeu est l'invariant n° 5 : une note posée par un enseignant ne doit
 * jamais être écrasée par une correction automatique ultérieure. Le vérifier
 * demande d'enchaîner réellement les deux opérations.
 *
 * Usage : npx tsx scripts/smoke-correction-audit.ts <cookie> [url]
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
  console.error("Cookie requis : npx tsx scripts/dev-session.ts");
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
async function refuse(label: string, fn: () => Promise<unknown>, motif?: RegExp) {
  try {
    await fn();
    ok(label, false, "acceptée alors qu'elle devait être refusée");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    ok(label, motif ? motif.test(m) : true, m.slice(0, 80));
  }
}

async function main() {
  console.log(`\n▶ Correction et journal d'audit — ${BASE}\n`);

  console.log("1. Préparation : tirage et copie saisie");
  const classes = await api.paper.listClasses.query();
  const tirage = await api.paper.createAndGenerate.mutate({
    evaluationId: 1,
    classId: classes[0].id,
    label: `Audit ${Date.now() % 100000}`,
  });
  const grille = await api.paper.entrySheet.query({ paperExamId: tirage.paperExamId });

  const db = getDb();
  const rows = await db
    .select()
    .from(questions)
    .where(inArray(questions.id, grille.questions.map((q) => q.id)));
  const bonne = new Map<number, number>();
  for (const r of rows) {
    const ru = GradingRubricSchema.safeParse(r.gradingRubric).data;
    if (ru?.mode.kind === "qcm") bonne.set(r.id, ru.mode.correctIndex);
    if (ru?.mode.kind === "true_false") bonne.set(r.id, ru.mode.correctValue === "true" ? 0 : 1);
  }

  // Copie volontairement fausse partout : l'override sera visible.
  const eleve = grille.copies[0];
  const saisie = await api.paper.saveEntry.mutate({
    paperExamId: tirage.paperExamId,
    studentId: eleve.studentId,
    answers: grille.questions.map((q) => ({
      questionId: q.id,
      choiceIndex: (bonne.get(q.id)! + 1) % q.choiceCount,
    })),
  });
  ok("copie saisie et notée", saisie.totalScore === 0, `${saisie.totalScore}/${saisie.maxScore}`);
  const sessionId = saisie.sessionId;

  console.log("\n2. Ouverture de la copie");
  const copie = await api.grading2.getResults.query({ sessionId });
  ok("détail question par question", copie.details.length > 0, `${copie.details.length} réponses`);
  ok("mode de correction visible", copie.details.every((d) => d.gradingMode !== null));
  const cible = copie.details.find((d) => d.questionType === "qcm")!;
  ok("réponse et barème exposés à l'enseignant", cible.maxScore > 0,
     `question ${cible.questionId}, ${cible.score}/${cible.maxScore}`);

  // L'identifiant de réponse est nécessaire pour l'override.
  const detail = await api.session.getDetailsForTeacher.query({ sessionId });
  const reponse = detail.responses.find((r) => r.questionId === cible.questionId)!;

  console.log("\n3. Correction manuelle");
  await refuse(
    "un motif est exigé",
    () => api.grading2.overrideGrade.mutate({ responseId: reponse.id, score: 1, reason: "" }),
    /reason|caract/i,
  );
  await refuse(
    "impossible de dépasser le barème de la question",
    () => api.grading2.overrideGrade.mutate({
      responseId: reponse.id, score: 99, reason: "tentative de dépassement" }),
    /vaut .* point/,
  );

  const apres1 = await api.grading2.overrideGrade.mutate({
    responseId: reponse.id,
    score: 1,
    reason: "Démarche juste, erreur de recopie",
  });
  ok("note manuelle appliquée", apres1.totalScore === 1, `total ${apres1.totalScore}`);

  console.log("\n4. Deuxième correction sur la même réponse");
  const apres2 = await api.grading2.overrideGrade.mutate({
    responseId: reponse.id,
    score: 0.5,
    reason: "Révision après relecture",
  });
  ok("la note est remplacée, pas cumulée", apres2.totalScore === 0.5, `total ${apres2.totalScore}`);

  console.log("\n5. Journal");
  const journal = await api.grading2.auditTrail.query({ sessionId });
  ok("les deux interventions sont tracées",
     journal.filter((l) => l.action === "manual_override").length === 2);
  const derniere = journal.find((l) => l.action === "manual_override")!;
  ok("auteur enregistré", derniere.auteur !== null, String(derniere.auteur));
  ok("ancienne et nouvelle valeurs", derniere.ancienneNote === 1 && derniere.nouvelleNote === 0.5,
     `${derniere.ancienneNote} → ${derniere.nouvelleNote}`);
  ok("motif conservé", derniere.motif === "Révision après relecture");
  ok("modes de correction tracés",
     derniere.ancienMode === "manual_override" && derniere.nouveauMode === "manual_override");
  ok("requestId rattaché", typeof derniere.requestId === "string" && derniere.requestId!.length > 0,
     String(derniere.requestId));

  console.log("\n6. Recorrection automatique");
  const regrade = await api.grading2.gradeSession.mutate({
    sessionId,
    reason: "Vérification après modification du barème",
  });
  ok("la copie est recorrigée", regrade.success === true, `total ${regrade.totalScore}`);
  ok("LA NOTE MANUELLE A SURVÉCU", regrade.totalScore === 0.5,
     `attendu 0.5, obtenu ${regrade.totalScore}`);

  const copieApres = await api.grading2.getResults.query({ sessionId });
  const cibleApres = copieApres.details.find((d) => d.questionId === cible.questionId)!;
  ok("mode manual_override conservé", cibleApres.gradingMode === "manual_override",
     String(cibleApres.gradingMode));
  ok("points conservés", cibleApres.score === 0.5, `${cibleApres.score}`);

  console.log("\n7. Historique complet");
  const final = await api.grading2.auditTrail.query({ sessionId });
  const actions = final.map((l) => l.action);
  ok("recorrection tracée", actions.includes("regrade"));
  ok("saisie des questions rédigées absente ici", !actions.includes("manual_paper"),
     `actions : ${[...new Set(actions)].join(", ")}`);
  ok("journal ordonné du plus récent au plus ancien",
     final.length >= 3 && final[0].date >= final[final.length - 1].date,
     `${final.length} entrées`);

  console.log(
    echecs === 0
      ? "\n✅ Correction manuelle traçable et protégée.\n"
      : `\n❌ ${echecs} vérification(s) en échec.\n`,
  );
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n❌ Interrompu :", e instanceof Error ? e.message : e);
  process.exit(1);
});

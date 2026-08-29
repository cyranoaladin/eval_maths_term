/**
 * scripts/smoke-atelier-enseignant.ts
 *
 * Parcours d'édition contre la base réelle, via `appRouter.createCaller` avec
 * un contexte enseignant. Vérifie ce que les tests unitaires ne voient pas :
 * SQL, contraintes d'intégrité, refus de cohérence à l'écriture.
 *
 * Usage : npx tsx scripts/smoke-atelier-enseignant.ts
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { appRouter } from "../api/router";
import type { TrpcContext } from "../api/context";
import { getDb } from "../api/queries/connection";
import { users } from "../db/schema";
import type { User } from "../db/schema";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function expectRejection(label: string, fn: () => Promise<unknown>, pattern?: RegExp) {
  try {
    await fn();
    check(label, false, "acceptée alors qu'elle devait être refusée");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(label, pattern ? pattern.test(msg) : true, msg.slice(0, 90));
  }
}

/** Enseignant de test, créé une fois puis réutilisé. */
async function teacher(): Promise<User> {
  const db = getDb();
  const unionId = "smoke-teacher";
  const [existing] = await db.select().from(users).where(eq(users.unionId, unionId)).limit(1);
  if (existing) return existing;
  await db.insert(users).values({
    unionId,
    name: "Enseignant Fumée",
    email: "smoke@example.test",
    role: "teacher",
  });
  const [created] = await db.select().from(users).where(eq(users.unionId, unionId)).limit(1);
  return created;
}

function contextFor(user: User): TrpcContext {
  return {
    req: new Request("http://localhost/api/trpc", { headers: { origin: "http://localhost:3000" } }),
    resHeaders: new Headers(),
    user,
  };
}

const QCM_VALIDE = {
  type: "qcm" as const,
  question: "Soit $f(x)=\\ln(x)$. Le domaine de définition de $f$ est :",
  options: ["$\\mathbb{R}$", "$]0;+\\infty[$", "$[0;+\\infty[$", "$\\mathbb{R}^*$"],
  correctAnswer: "1",
  points: 1,
  gradingRubric: {
    mode: { kind: "qcm" as const, correctIndex: 1 },
    llmReviewRequired: false,
    weight: 1,
    detailedRubric: "Le logarithme n'est défini que sur les réels strictement positifs.",
  },
  tags: ["logarithme"],
  difficulty: 1,
};

async function main() {
  console.log("\n▶ Atelier enseignant\n");
  const user = await teacher();
  const api = appRouter.createCaller(contextFor(user));

  console.log("1. Création");
  const { id: evalId } = await api.authoring.createEvaluation({
    title: `QCM de fumée ${Date.now()}`,
    description: "Créé par le script de vérification",
    duration: 30,
    deliveryMode: "paper",
    subject: "Mathématiques",
    level: "Terminale",
  });
  check("évaluation créée", evalId > 0, `id=${evalId}`);

  const listed = await api.authoring.listEvaluations();
  const mine = listed.find((e) => e.id === evalId);
  check("elle apparaît dans la liste", !!mine);
  check("elle naît inactive", mine?.isActive === false);
  check("elle naît sans question", mine?.questionCount === 0);

  await expectRejection(
    "activer une évaluation vide est refusé",
    () => api.authoring.updateEvaluation({ id: evalId, isActive: true }),
    /sans question/,
  );

  console.log("\n2. Cohérence à l'écriture");
  await expectRejection(
    "QCM dont la fiche contredit le barème",
    () => api.authoring.createQuestion({
      evaluationId: evalId,
      question: { ...QCM_VALIDE, correctAnswer: "3" },
    }),
    /Incohérence/,
  );
  await expectRejection(
    "QCM dont la bonne réponse sort des propositions",
    () => api.authoring.createQuestion({
      evaluationId: evalId,
      question: {
        ...QCM_VALIDE,
        correctAnswer: "9",
        gradingRubric: { ...QCM_VALIDE.gradingRubric, mode: { kind: "qcm", correctIndex: 9 } },
      },
    }),
    /proposition 10/,
  );
  await expectRejection(
    "QCM à une seule proposition",
    () => api.authoring.createQuestion({
      evaluationId: evalId,
      question: {
        ...QCM_VALIDE,
        options: ["$\\mathbb{R}$"],
        correctAnswer: "0",
        gradingRubric: { ...QCM_VALIDE.gradingRubric, mode: { kind: "qcm", correctIndex: 0 } },
      },
    }),
    /au moins deux propositions/,
  );

  console.log("\n3. Questions");
  const q1 = await api.authoring.createQuestion({ evaluationId: evalId, question: QCM_VALIDE });
  const q2 = await api.authoring.createQuestion({
    evaluationId: evalId,
    question: {
      ...QCM_VALIDE,
      question: "La dérivée de $x\\mapsto e^{2x}$ est :",
      options: ["$e^{2x}$", "$2e^{2x}$", "$2xe^{2x}$", "$e^{2}$"],
      correctAnswer: "1",
      points: 2,
      gradingRubric: { ...QCM_VALIDE.gradingRubric, mode: { kind: "qcm", correctIndex: 1 }, weight: 2 },
    },
  });
  check("deux questions ajoutées", q1.id > 0 && q2.id > 0);

  const detail = await api.authoring.getEvaluation({ id: evalId });
  check("les questions sont relues", detail.questions.length === 2);
  check("le barème est calculé", detail.maxScore === 3, `${detail.maxScore} points`);
  check("l'ordre est séquentiel", detail.questions.map((q) => q.order).join(",") === "1,2");
  check("les propositions sont désérialisées",
    Array.isArray(detail.questions[0].options) && detail.questions[0].options!.length === 4);
  check("la rubric est relue et valide", detail.questions[0].gradingRubric?.mode.kind === "qcm");

  console.log("\n4. Réordonnancement");
  await api.authoring.reorderQuestions({ evaluationId: evalId, orderedIds: [q2.id, q1.id] });
  const reordered = await api.authoring.getEvaluation({ id: evalId });
  check("l'ordre est inversé", reordered.questions[0].id === q2.id);

  await expectRejection(
    "réordonner avec une liste incomplète est refusé",
    () => api.authoring.reorderQuestions({ evaluationId: evalId, orderedIds: [q1.id] }),
    /exactement les questions/,
  );

  console.log("\n5. Activation et duplication");
  await api.authoring.updateEvaluation({ id: evalId, isActive: true });
  const active = (await api.authoring.listEvaluations()).find((e) => e.id === evalId);
  check("l'évaluation peut être activée une fois peuplée", active?.isActive === true);

  const dup = await api.authoring.duplicateEvaluation({ id: evalId });
  check("duplication avec ses questions", dup.questionCount === 2, `nouvelle id=${dup.id}`);
  const copie = await api.authoring.getEvaluation({ id: dup.id });
  check("la copie naît inactive", copie.evaluation.isActive === false);
  check("la copie a le même barème", copie.maxScore === 3);

  console.log("\n6. Suppression");
  await api.authoring.deleteQuestion({ id: q1.id });
  check("question supprimée", (await api.authoring.getEvaluation({ id: evalId })).questions.length === 1);

  await api.authoring.deleteEvaluation({ id: dup.id });
  await api.authoring.deleteEvaluation({ id: evalId });
  const restant = (await api.authoring.listEvaluations()).some((e) => e.id === evalId || e.id === dup.id);
  check("les deux évaluations sont supprimées", !restant);

  await expectRejection(
    "supprimer l'évaluation de référence est refusé (copies existantes)",
    () => api.authoring.deleteEvaluation({ id: 1 }),
    /copie|Évaluation introuvable/,
  );

  console.log(
    failures === 0 ? "\n✅ Atelier vérifié.\n" : `\n❌ ${failures} vérification(s) en échec.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n❌ Interrompu :", e);
  process.exit(1);
});

/**
 * scripts/profil-submit.ts
 *
 * Décomposition du coût d'une remise de copie.
 *
 * La mesure de charge dit que `session.submit` tient mal la simultanéité. Elle
 * ne dit pas pourquoi. Avant de changer quoi que ce soit — et surtout avant de
 * conclure qu'il faudrait corriger en différé —, il faut savoir où passe le
 * temps : dans le calcul, dans les allers-retours à la base, ou dans l'attente
 * du pool de connexions.
 *
 * Le profil s'exécute en processus, sans serveur HTTP : ce qu'on veut isoler
 * est le travail de correction, pas le transport.
 *
 *   PROFIL_SQL=1 npx tsx scripts/profil-submit.ts [répétitions]
 */
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import {
  getDb, demarrerComptageRequetes, lireComptageRequetes, arreterComptageRequetes,
} from "../api/queries/connection";
import { gradeSessionResponses } from "../api/grading/grade-session";
import {
  answerDrafts, cheatEvents, evaluations, questions, responses, sessions,
} from "../db/schema";
import { env } from "../api/lib/env";

const REPETITIONS = Number(process.argv[2] ?? 5);
const db = getDb();

interface Etape { nom: string; ms: number }

function chrono() {
  const etapes: Etape[] = [];
  let dernier = performance.now();
  return {
    marquer(nom: string) {
      const maintenant = performance.now();
      etapes.push({ nom, ms: maintenant - dernier });
      dernier = maintenant;
    },
    etapes,
  };
}

async function evaluationDeReference() {
  const [ev] = await db.select().from(evaluations).where(eq(evaluations.isActive, true)).limit(1);
  if (!ev) throw new Error("Aucune évaluation active");
  const qs = await db.select().from(questions).where(eq(questions.evaluationId, ev.id));
  return { evaluationId: ev.id, questions: qs };
}

async function main() {
  if (process.env.PROFIL_SQL !== "1") {
    console.log("⚠  Lancez avec PROFIL_SQL=1 pour compter les requêtes.\n");
  }

  const { evaluationId, questions: qs } = await evaluationDeReference();
  console.log(`▶ Profil de la remise — évaluation #${evaluationId}, ${qs.length} questions`);
  console.log(`   pool de connexions : ${env.dbPoolSize}\n`);

  const cumul = new Map<string, number[]>();
  let requetesParRemise = 0;
  const sessionsCreees: number[] = [];

  for (let i = 0; i < REPETITIONS; i++) {
    const c = chrono();

    const debut = Date.now();
    const [row] = await db.insert(sessions).values({
      evaluationId,
      studentName: `Profil ${i}`,
      status: "in_progress",
      shuffleSeed: "graine-profil",
      startedAt: new Date(debut),
      expiresAt: new Date(debut + 3_600_000),
    });
    const sessionId = Number(row.insertId);
    sessionsCreees.push(sessionId);
    c.marquer("ouverture de session");

    // Une copie complète : c'est ce que fait un élève qui compose jusqu'au bout.
    for (const q of qs) {
      await db.insert(responses).values({
        sessionId,
        questionId: q.id,
        answer: q.type === "qcm" ? "0" : q.type === "true_false" ? "true" : "2",
      });
    }
    c.marquer("écriture des réponses");

    demarrerComptageRequetes();
    const t0 = performance.now();
    await gradeSessionResponses(sessionId, { skipLLM: true });
    const correction = performance.now() - t0;
    requetesParRemise = lireComptageRequetes();
    arreterComptageRequetes();
    c.marquer("correction complète");

    for (const e of c.etapes) {
      if (!cumul.has(e.nom)) cumul.set(e.nom, []);
      cumul.get(e.nom)!.push(e.ms);
    }
    if (!cumul.has("dont correction")) cumul.set("dont correction", []);
    cumul.get("dont correction")!.push(correction);
  }

  const p = (v: number[], q: number) => {
    const t = [...v].sort((a, b) => a - b);
    return t[Math.min(t.length - 1, Math.floor(q * t.length))];
  };

  console.log(`${"ÉTAPE".padEnd(26)} ${"moy".padStart(8)} ${"p50".padStart(8)} ${"max".padStart(8)}`);
  for (const [nom, valeurs] of cumul) {
    const moy = valeurs.reduce((a, b) => a + b, 0) / valeurs.length;
    console.log(
      `${nom.padEnd(26)} ${moy.toFixed(1).padStart(7)}ms ${p(valeurs, 0.5).toFixed(1).padStart(7)}ms ${Math.max(...valeurs).toFixed(1).padStart(7)}ms`,
    );
  }

  // ── Part du calcul, part de la base ────────────────────────────────────────
  // Le même travail de correction, sans aucune écriture : la différence avec la
  // correction complète est ce que coûtent les allers-retours à la base.
  const { gradeResponse } = await import("../api/grading/grade-response");
  const { GradingRubricSchema } = await import("../contracts/grading-rubric");
  const { resolveSubmittedQcmIndex } = await import("../api/grading/grade-session");

  const calculs: number[] = [];
  for (let i = 0; i < REPETITIONS; i++) {
    const t0 = performance.now();
    for (const q of qs) {
      const rubric = GradingRubricSchema.safeParse(q.gradingRubric);
      if (!rubric.success) continue;
      const reponse = q.type === "qcm" ? "0" : q.type === "true_false" ? "true" : "2";
      await gradeResponse({
        questionType: q.type,
        studentAnswer: reponse,
        rubric: rubric.data,
        questionText: q.question,
        maxPoints: q.points,
        resolvedQcmIndex:
          q.type === "qcm"
            ? resolveSubmittedQcmIndex({
                rawOptions: q.options,
                shuffleSeed: "graine-profil",
                questionId: q.id,
                submittedAnswer: reponse,
                mode: "online",
              })
            : undefined,
        skipLLM: true,
      });
    }
    calculs.push(performance.now() - t0);
  }
  const moyCalcul = calculs.reduce((a, b) => a + b, 0) / calculs.length;
  const moyCorrection =
    (cumul.get("dont correction") ?? []).reduce((a, b) => a + b, 0) / REPETITIONS;

  console.log(`\n${"PART".padEnd(26)} ${"moy".padStart(8)}`);
  console.log(`${"calcul seul (mathjs)".padEnd(26)} ${moyCalcul.toFixed(1).padStart(7)}ms`);
  console.log(`${"correction complète".padEnd(26)} ${moyCorrection.toFixed(1).padStart(7)}ms`);
  console.log(`${"donc base de données".padEnd(26)} ${(moyCorrection - moyCalcul).toFixed(1).padStart(7)}ms`);

  console.log(`\nRequêtes SQL par correction : ${requetesParRemise}`);
  console.log(`Questions corrigées         : ${qs.length}`);
  console.log(`Requêtes par question       : ${(requetesParRemise / qs.length).toFixed(1)}`);

  // ── La procédure de remise dans son entier ────────────────────────────────
  // La correction n'est qu'une partie du travail : la remise écrit d'abord
  // toutes les réponses de l'élève, puis calcule la suspicion et signe le jeton
  // de résultats. C'est ce total que mesure la charge.
  const { appRouter } = await import("../api/router");
  const { signStudentToken } = await import("../api/anticheat/session-token");

  const remises: number[] = [];
  let requetesParSubmit = 0;
  for (let i = 0; i < REPETITIONS; i++) {
    const debut = Date.now();
    const [row] = await db.insert(sessions).values({
      evaluationId,
      studentName: `Profil submit ${i}`,
      status: "in_progress",
      shuffleSeed: "graine-profil",
      startedAt: new Date(debut),
      expiresAt: new Date(debut + 3_600_000),
    });
    const sessionId = Number(row.insertId);
    sessionsCreees.push(sessionId);

    const jeton = await signStudentToken({
      sessionId,
      evaluationId,
      studentName: `Profil submit ${i}`,
      startedAt: debut,
      expiresAt: debut + 3_600_000,
      shuffleSeed: "graine-profil",
    });

    const appelant = appRouter.createCaller({
      req: new Request("http://localhost/api/trpc", {
        headers: { "x-student-session-token": jeton },
      }),
      resHeaders: new Headers(),
    });

    demarrerComptageRequetes();
    const t0 = performance.now();
    await appelant.session.submit({
      answers: qs.map((q) => ({
        questionId: q.id,
        answer: q.type === "qcm" ? "0" : q.type === "true_false" ? "true" : "2",
      })),
      timeSpent: 300,
    });
    remises.push(performance.now() - t0);
    requetesParSubmit = lireComptageRequetes();
    arreterComptageRequetes();
  }

  const moyRemise = remises.reduce((a, b) => a + b, 0) / remises.length;
  console.log(`\n${"REMISE COMPLÈTE".padEnd(26)} ${"moy".padStart(8)} ${"p50".padStart(8)} ${"max".padStart(8)}`);
  console.log(
    `${"session.submit".padEnd(26)} ${moyRemise.toFixed(1).padStart(7)}ms ${p(remises, 0.5).toFixed(1).padStart(7)}ms ${Math.max(...remises).toFixed(1).padStart(7)}ms`,
  );
  console.log(`${"dont correction".padEnd(26)} ${moyCorrection.toFixed(1).padStart(7)}ms`);
  console.log(`${"dont écriture + suspicion".padEnd(26)} ${(moyRemise - moyCorrection).toFixed(1).padStart(7)}ms`);
  console.log(`Requêtes SQL par remise     : ${requetesParSubmit}`);

  // Nettoyage : le profil ne doit pas laisser de copies derrière lui.
  if (sessionsCreees.length) {
    await db.delete(answerDrafts).where(inArray(answerDrafts.sessionId, sessionsCreees));
    await db.delete(cheatEvents).where(inArray(cheatEvents.sessionId, sessionsCreees));
    await db.delete(responses).where(inArray(responses.sessionId, sessionsCreees));
    await db.delete(sessions).where(inArray(sessions.id, sessionsCreees));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

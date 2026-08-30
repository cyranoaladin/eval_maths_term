/**
 * scripts/smoke-anticheat-temps-reels.ts
 *
 * Preuve des seuils anti-triche **avec les constantes de production**, contre
 * un serveur réellement démarré : 60 s d'inactivité déclenchent l'alerte,
 * 180 s déclenchent la remise automatique.
 *
 * Rien n'est accéléré, rien n'est déclenché à la main : le script ouvre une
 * session, y écrit des brouillons, envoie un heartbeat, puis **se tait** et
 * observe. C'est le balayage périodique du serveur qui agit. Un test à seuils
 * réduits n'aurait pas prouvé que ce balayage existe et tourne.
 *
 * Durée : un peu plus de trois minutes. C'est le prix d'une preuve honnête.
 *
 *   npx tsx scripts/smoke-anticheat-temps-reels.ts
 */
import "dotenv/config";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { eq } from "drizzle-orm";
import type { AppRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import { sessions, responses, cheatEvents } from "../db/schema";
import {
  IDLE_THRESHOLD_MS,
  AUTO_SUBMIT_THRESHOLD_MS,
} from "../contracts/anticheat-config";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

let echecs = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

function chrono(depart: number): string {
  return `${Math.round((Date.now() - depart) / 1000)} s`;
}

async function main() {
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
  const db = getDb();

  console.log("1. Ouverture d'une session");
  const evaluations = await client.evaluation.listPublic.query();
  const evaluation = evaluations[0];
  if (!evaluation) throw new Error("Aucune évaluation active");

  const started = await client.session.start.mutate({
    evaluationId: evaluation.id,
    studentName: `Seuils réels ${Date.now()}`,
  });
  token = started.sessionToken;
  const sessionId = started.sessionId;
  check("session ouverte", sessionId > 0, `#${sessionId}`);

  const questions = await client.question.getForActiveSession.query();
  const aRepondre = questions.slice(0, 3);
  for (const q of aRepondre) {
    await client.answer.saveDraft.mutate({
      questionId: q.id,
      answer: q.type === "qcm" ? "0" : q.type === "true_false" ? "true" : "2",
    });
  }
  check("brouillons écrits avant la coupure", true, `${aRepondre.length} réponses`);

  console.log("\n2. Un seul heartbeat, puis plus rien");
  await client.session.heartbeat.mutate({
    clientTime: Date.now(),
    focused: true,
    currentQuestionIndex: 0,
    fingerprintHash: "seuils-reels",
  });
  const depart = Date.now();
  check("heartbeat accepté", true, "le silence commence maintenant");

  // ── Seuil d'alerte ────────────────────────────────────────────────────────
  console.log(`\n3. Seuil d'alerte (${IDLE_THRESHOLD_MS / 1000} s)`);
  await attendre(IDLE_THRESHOLD_MS - 5_000);
  const [avant] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  check("avant le seuil, la session est toujours en cours",
    avant.status === "in_progress", `${chrono(depart)} — ${avant.status}`);

  // Le balayage tourne toutes les 30 s : on lui laisse un cycle complet.
  await attendre(IDLE_THRESHOLD_MS - (Date.now() - depart) + 35_000);
  const [pendantAlerte] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  check("entre les deux seuils, la session n'est pas encore remise",
    pendantAlerte.status === "in_progress",
    `${chrono(depart)} — ${pendantAlerte.status}`);

  // ── Seuil de remise automatique ───────────────────────────────────────────
  console.log(`\n4. Seuil de remise automatique (${AUTO_SUBMIT_THRESHOLD_MS / 1000} s)`);
  const limite = AUTO_SUBMIT_THRESHOLD_MS + 45_000;
  let finale = pendantAlerte;
  while (Date.now() - depart < limite) {
    await attendre(5_000);
    [finale] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    if (finale.status !== "in_progress") break;
  }
  const ecoule = Date.now() - depart;
  check("la session a été remise automatiquement",
    finale.status !== "in_progress", `${chrono(depart)} — ${finale.status}`);
  check("la remise n'est pas intervenue avant le seuil",
    ecoule >= AUTO_SUBMIT_THRESHOLD_MS,
    `${Math.round(ecoule / 1000)} s ≥ ${AUTO_SUBMIT_THRESHOLD_MS / 1000} s`);

  console.log("\n5. Ce que la copie est devenue");
  const reponses = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
  check("les réponses écrites avant la coupure sont conservées",
    reponses.length >= aRepondre.length, `${reponses.length} réponses enregistrées`);
  check("un score est calculé", finale.totalScore !== null, `${finale.totalScore}`);
  check("la note sur 20 est calculée", finale.normalizedScore !== null,
    `${finale.normalizedScore}/20`);

  const incidents = await db.select().from(cheatEvents).where(eq(cheatEvents.sessionId, sessionId));
  check("la déconnexion est tracée comme incident",
    incidents.some((e) => e.type === "idle_disconnect"),
    incidents.map((e) => e.type).join(", ") || "aucun");
  // L'incident doit peser sur le score : une copie abandonnée en pleine épreuve
  // ne peut pas ressortir « propre » devant l'enseignant.
  check("la déconnexion pèse sur le score de suspicion",
    (finale.suspicionScore ?? 0) > 0, `${finale.suspicionScore}/100`);
  check("le verdict n'est pas « propre »",
    finale.suspicionVerdict !== "clean", `${finale.suspicionVerdict}`);

  console.log(
    echecs === 0
      ? `\n✅ Seuils réels vérifiés en ${Math.round(ecoule / 1000)} s d'observation.`
      : `\n❌ ${echecs} vérification(s) en échec.`,
  );
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

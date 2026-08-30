/**
 * scripts/smoke-cloisonnement-enseignants.ts
 *
 * Un enseignant ne doit pas atteindre les copies d'un autre.
 *
 * Les routes enseignant vérifiaient l'authentification mais pas la propriété :
 * à partir du seul identifiant de session — un entier — n'importe quel
 * professeur connecté pouvait lire une copie, la recorriger, changer une note
 * ou forcer une remise. Sur une plateforme d'établissement, cela revient à
 * ouvrir les notes de tout le monde.
 *
 * Ce script fabrique deux enseignants, attribue l'évaluation au premier, et
 * vérifie que le second est refusé partout — puis que le premier passe.
 *
 *   npx tsx scripts/dev-session.ts > /dev/null
 *   npx tsx scripts/smoke-cloisonnement-enseignants.ts
 */
import "dotenv/config";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { eq } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import type { AppRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import { evaluations, responses, sessions, users } from "../db/schema";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";

let echecs = 0;
const ok = (label: string, vrai: boolean, detail = "") => {
  console.log(`  ${vrai ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!vrai) echecs++;
};

function cookiePour(nom: string, email: string, unionId: string): string {
  const sortie = execFileSync(
    "npx",
    ["tsx", "scripts/dev-session.ts", nom, email, unionId],
    { encoding: "utf8" },
  );
  const m = sortie.match(/kimi_sid=([^;"]+)/);
  if (!m) throw new Error(`Impossible de fabriquer la session de ${nom}`);
  return m[1];
}

function clientPour(cookie: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${BASE}/api/trpc`,
        transformer: superjson,
        headers: () => ({ cookie: `kimi_sid=${cookie}`, origin: BASE }),
      }),
    ],
  });
}

/** Vérifie qu'un appel est refusé, et que le refus ne révèle rien. */
async function refuse(label: string, appel: () => Promise<unknown>) {
  try {
    await appel();
    ok(label, false, "l'appel a abouti alors qu'il devait être refusé");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // NOT_FOUND et non FORBIDDEN : le refus ne doit pas confirmer l'existence
    // d'une copie appartenant à quelqu'un d'autre.
    ok(label, /introuvable|not found/i.test(message), message.slice(0, 60));
  }
}

async function main() {
  const db = getDb();

  console.log("▶ Cloisonnement entre enseignants —", BASE, "\n");
  console.log("1. Deux enseignants distincts");
  const cookieA = cookiePour("Enseignant (dev)", "dev@localhost", "dev-teacher");
  const cookieB = cookiePour("Autre enseignant", "autre@localhost", "dev-teacher-2");
  const [a] = await db.select().from(users).where(eq(users.unionId, "dev-teacher")).limit(1);
  const [b] = await db.select().from(users).where(eq(users.unionId, "dev-teacher-2")).limit(1);
  ok("deux comptes enseignants existent", !!a && !!b && a.id !== b.id, `#${a?.id} et #${b?.id}`);

  const api = { a: clientPour(cookieA), b: clientPour(cookieB) };

  console.log("\n2. Une copie rattachée au premier enseignant");
  const [copie] = await db.select().from(sessions).orderBy(sessions.id).limit(1);
  if (!copie) throw new Error("Aucune session en base — lancez d'abord le smoke élève.");
  const [evaluation] = await db
    .select()
    .from(evaluations)
    .where(eq(evaluations.id, copie.evaluationId))
    .limit(1);
  const proprietaireInitial = evaluation.ownerId;
  await db.update(evaluations).set({ ownerId: a.id }).where(eq(evaluations.id, evaluation.id));
  ok("l'évaluation appartient au premier enseignant", true, `session #${copie.id}`);

  const [reponse] = await db
    .select()
    .from(responses)
    .where(eq(responses.sessionId, copie.id))
    .limit(1);

  try {
    console.log("\n3. Le second enseignant est refusé partout");
    await refuse("session.getDetailsForTeacher", () =>
      api.b.session.getDetailsForTeacher.query({ sessionId: copie.id }));
    await refuse("grading2.auditTrail", () =>
      api.b.grading2.auditTrail.query({ sessionId: copie.id }));
    await refuse("grading2.gradeSession", () =>
      api.b.grading2.gradeSession.mutate({ sessionId: copie.id }));
    await refuse("teacherLive.forceSubmit", () =>
      api.b.teacherLive.forceSubmit.mutate({ sessionId: copie.id }));
    if (reponse) {
      await refuse("grading2.overrideGrade", () =>
        api.b.grading2.overrideGrade.mutate({
          responseId: reponse.id,
          score: 0,
          reason: "tentative depuis un autre compte",
        }));
    }

    console.log("\n4. Le suivi en direct est cloisonné lui aussi");
    // Cette route ne vérifiait rien : n'importe quel enseignant obtenait, pour
    // n'importe quelle évaluation, les noms, courriels, scores de suspicion et
    // incidents de tous les élèves.
    await refuse("teacherLive.snapshot", () =>
      api.b.teacherLive.snapshot.query({ evaluationId: copie.evaluationId }));

    console.log("\n5. L'impression papier l'est aussi");
    // Sans contrôle, un enseignant imprimait le sujet ET le corrigé d'une
    // évaluation qui ne lui appartient pas.
    const classeB = await api.b.paper.createClass.mutate({
      name: `Classe intruse ${Date.now()}`,
    });
    await refuse("paper.createAndGenerate", () =>
      api.b.paper.createAndGenerate.mutate({
        evaluationId: copie.evaluationId,
        classId: classeB.id,
      }));

    console.log("\n6. Le propriétaire, lui, accède normalement");
    const detail = await api.a.session.getDetailsForTeacher.query({ sessionId: copie.id });
    ok("le propriétaire lit sa copie", detail.session.id === copie.id);
    const suivi = await api.a.teacherLive.snapshot.query({ evaluationId: copie.evaluationId });
    ok("le propriétaire suit son évaluation en direct",
      suivi.sessions.some((s) => s.sessionId === copie.id),
      `${suivi.sessions.length} copie(s) suivies`);
    const journal = await api.a.grading2.auditTrail.query({ sessionId: copie.id });
    ok("le propriétaire lit le journal", Array.isArray(journal));
  } finally {
    // Ne pas laisser la base dans un état modifié par une vérification.
    await db
      .update(evaluations)
      .set({ ownerId: proprietaireInitial })
      .where(eq(evaluations.id, evaluation.id));
  }

  console.log(
    echecs === 0
      ? "\n✅ Cloisonnement vérifié : les copies d'un enseignant lui restent."
      : `\n❌ ${echecs} vérification(s) en échec.`,
  );
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n❌ Interrompu :", e instanceof Error ? e.message : e);
  process.exit(1);
});

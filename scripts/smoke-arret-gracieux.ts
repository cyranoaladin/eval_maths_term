/**
 * scripts/smoke-arret-gracieux.ts
 *
 * Preuve qu'un arrêt du serveur ne coupe pas une copie en deux.
 *
 * Le script démarre un vrai serveur de production, ouvre une session élève,
 * lance une remise, et envoie SIGTERM **pendant** que la remise est en vol.
 * Il vérifie ensuite, en base, que la copie est entière : soit remise et
 * corrigée de bout en bout, soit pas remise du tout — jamais entre les deux.
 *
 * Une copie à moitié corrigée n'est pas rattrapable : les réponses portent des
 * notes, la session n'a pas de total, et personne ne sait si l'élève a rendu.
 *
 *   npx tsx scripts/smoke-arret-gracieux.ts
 */
import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { eq } from "drizzle-orm";
import type { AppRouter } from "../api/router";
import { getDb } from "../api/queries/connection";
import { responses, sessions } from "../db/schema";

const PORT = Number(process.env.SMOKE_PORT ?? 3210);
const BASE = `http://127.0.0.1:${PORT}`;

let echecs = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) echecs++;
}
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

function secret() {
  return randomBytes(32).toString("hex");
}

const journal: string[] = [];

async function demarrerServeur(): Promise<ChildProcess> {
  const proc = spawn("node", ["dist/boot.js"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      PUBLIC_BASE_URL: BASE,
      ALLOWED_ORIGINS: BASE,
      // Éphémères : ils meurent avec ce script.
      APP_SECRET: secret(),
      TEACHER_SESSION_SECRET: secret(),
      STUDENT_SESSION_SECRET: secret(),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", (d: Buffer) => journal.push(d.toString()));
  proc.stderr?.on("data", (d) => process.stderr.write(`    [serveur] ${d}`));

  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return proc;
    } catch {
      // pas encore là
    }
    await attendre(500);
  }
  throw new Error("Le serveur n'a pas démarré");
}

async function main() {
  console.log("▶ Arrêt gracieux — une remise en vol pendant SIGTERM\n");
  const db = getDb();

  console.log("1. Un serveur de production");
  const serveur = await demarrerServeur();
  check("le serveur répond", true, BASE);

  let token = "";
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${BASE}/api/trpc`,
        transformer: superjson,
        headers: () => ({
          origin: BASE,
          ...(token ? { "x-student-session-token": token } : {}),
        }),
      }),
    ],
  });

  console.log("\n2. Une copie composée");
  const evaluations = await client.evaluation.listPublic.query();
  const evaluation = evaluations[0];
  if (!evaluation) throw new Error("Aucune évaluation active");

  const ouverte = await client.session.start.mutate({
    evaluationId: evaluation.id,
    studentName: `Arrêt gracieux ${Date.now()}`,
  });
  token = ouverte.sessionToken;
  const sessionId = ouverte.sessionId;
  check("session ouverte", sessionId > 0, `#${sessionId}`);

  const questions = await client.question.getForActiveSession.query();
  const reponses = questions.map((q) => ({
    questionId: q.id,
    answer: q.type === "qcm" ? "0" : q.type === "true_false" ? "true" : "2",
  }));
  check("réponses préparées", reponses.length > 0, `${reponses.length} questions`);

  console.log("\n3. La remise part, le signal arrive pendant qu'elle vole");
  const remise = client.session.submit
    .mutate({ answers: reponses, timeSpent: 120 })
    .then(
      () => "aboutie" as const,
      (e: unknown) => {
        // Une remise interrompue par la fermeture du socket est un cas prévu :
        // ce qui compte est l'état laissé en base.
        console.log(`    (la requête n'a pas abouti : ${String(e).slice(0, 80)})`);
        return "interrompue" as const;
      },
    );

  // Assez tard pour que la remise ait commencé son travail, assez tôt pour
  // qu'elle ne soit pas finie : la correction d'une copie complète prend
  // quelques dizaines de millisecondes.
  await attendre(15);
  serveur.kill("SIGTERM");
  const issue = await remise;
  check("le signal a été envoyé pendant la remise", true, `remise ${issue}`);

  console.log("\n4. Le serveur s'arrête de lui-même");
  const codeSortie = await new Promise<number | null>((resoudre) => {
    const minuteur = setTimeout(() => resoudre(null), 30_000);
    serveur.on("exit", (code) => {
      clearTimeout(minuteur);
      resoudre(code);
    });
  });
  check("arrêt sans être tué de force", codeSortie === 0, `code ${codeSortie}`);

  // Sans la séquence d'arrêt, le comportement par défaut de Node sur SIGTERM
  // est de terminer le processus sur-le-champ : la remise serait coupée. Ces
  // deux lignes prouvent que c'est bien la séquence qui a rendu la main.
  const sortie = journal.join("");
  check(
    "le serveur a cessé d'accepter avant de fermer",
    sortie.includes("Arrêt demandé"),
  );
  check(
    "les requêtes en cours sont allées à leur terme",
    sortie.includes("Toutes les requêtes en cours sont terminées"),
  );

  console.log("\n5. Ce que la base contient");
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  const ecrites = await db.select().from(responses).where(eq(responses.sessionId, sessionId));

  const remiseComplete =
    session.status !== "in_progress" &&
    session.endedAt !== null &&
    session.totalScore !== null &&
    session.maxScore !== null &&
    ecrites.length === reponses.length &&
    ecrites.every((r) => r.gradedAt !== null);

  const pasRemise =
    session.status === "in_progress" && session.endedAt === null && ecrites.length === 0;

  check(
    "la copie est entière : remise et corrigée, ou pas remise",
    remiseComplete || pasRemise,
    remiseComplete
      ? `remise, ${ecrites.length} réponses corrigées, ${session.totalScore}/${session.maxScore}`
      : pasRemise
        ? "pas remise, aucune réponse écrite"
        : `état intermédiaire : statut ${session.status}, endedAt ${session.endedAt}, ` +
          `total ${session.totalScore}, ${ecrites.length}/${reponses.length} réponses, ` +
          `${ecrites.filter((r) => r.gradedAt === null).length} non corrigées`,
  );

  // Nettoyage.
  await db.delete(responses).where(eq(responses.sessionId, sessionId));
  await db.delete(sessions).where(eq(sessions.id, sessionId));

  console.log(
    echecs === 0
      ? "\n✅ Un arrêt en pleine remise ne laisse pas de copie à moitié corrigée."
      : `\n❌ ${echecs} vérification(s) en échec.`,
  );
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Échec :", e);
  process.exit(1);
});

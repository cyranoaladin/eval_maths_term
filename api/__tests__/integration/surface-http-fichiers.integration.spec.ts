/**
 * Les routes servies hors tRPC : santé, disponibilité, documents d'un tirage.
 *
 * Les documents sont des PDF, et les faire transiter en JSON encodé serait
 * absurde — ils sortent donc du cadre habituel, avec leurs propres gardes :
 * rôle enseignant, propriété de la classe, et un nom de fichier pris dans une
 * liste fermée. Chacune de ces gardes est la seule de son espèce.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import application from "../../boot";
import { creerEnseignant, db, nettoyer, unique } from "./harnais";
import { classes, evaluations, paperExams, questions, students } from "@db/schema";
import type { User } from "@db/schema";
import { signSessionToken } from "../../kimi/session";
import { generatePaperExam, workdirFor } from "../../paper/paper-service";
import { env } from "../../lib/env";
import { Session } from "@contracts/constants";

let prof: User;
let eleve: User;
let examId = 0;
let racine = "";
const PATH_INITIAL = process.env.PATH;
const evaluationsCreees: number[] = [];
const dossiers: string[] = [];

const SCRIPT = `#!/bin/bash
if [ "$1" = "prepare" ] && [ "$3" = "s" ]; then
  printf '%%PDF-1.4 sujet' > sujet.pdf
  printf '%%PDF-1.4 corrige' > corrige.pdf
  printf 'x' > calage.xy
fi
exit 0
`;

/** Une requête présentée avec le cookie de session d'un enseignant. */
async function commeUtilisateur(utilisateur: User | null, chemin: string) {
  const entetes: Record<string, string> = {};
  if (utilisateur) {
    const jeton = await signSessionToken({ unionId: utilisateur.unionId, clientId: env.appId });
    entetes.cookie = `${Session.cookieName}=${jeton}`;
  }
  return application.request(`http://atelier.test${chemin}`, { headers: entetes });
}

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant documents");
  eleve = await creerEnseignant("Compte élève", "student");

  racine = await mkdtemp(join(tmpdir(), "amc-http-"));
  await mkdir(join(racine, "bin"), { recursive: true });
  await writeFile(join(racine, "bin", "auto-multiple-choice"), SCRIPT, "utf8");
  await chmod(join(racine, "bin", "auto-multiple-choice"), 0o755);
  process.env.PATH = `${join(racine, "bin")}:${PATH_INITIAL ?? ""}`;

  const [ev] = await db.insert(evaluations).values({
    title: unique("Documents"),
    duration: 30,
    isActive: true,
    ownerId: prof.id,
  });
  const evaluationId = Number(ev.insertId);
  evaluationsCreees.push(evaluationId);
  await db.insert(questions).values({
    evaluationId,
    type: "qcm",
    question: "Combien font deux et deux ?",
    options: JSON.stringify(["$3$", "$4$", "$5$", "$6$"]),
    correctAnswer: "1",
    points: 2,
    order: 1,
    gradingRubric: { mode: { kind: "qcm", correctIndex: 1 }, llmReviewRequired: false, weight: 2 },
  } as never);

  const [c] = await db.insert(classes).values({ name: unique("Classe"), ownerId: prof.id });
  const classId = Number(c.insertId);
  await db.insert(students).values({
    classId,
    lastName: "Benkhelifa",
    firstName: "Aïcha",
    active: true,
  });
  const [e] = await db.insert(paperExams).values({
    evaluationId,
    classId,
    label: "Tirage documents",
    createdById: prof.id,
  });
  examId = Number(e.insertId);
  dossiers.push(workdirFor(examId));
  await generatePaperExam({ paperExamId: examId, userId: prof.id });
});

afterAll(async () => {
  process.env.PATH = PATH_INITIAL;
  await nettoyer(evaluationsCreees, []);
  const cls = await db.select({ id: classes.id }).from(classes).where(eq(classes.ownerId, prof.id));
  for (const c of cls) await db.delete(students).where(eq(students.classId, c.id));
  await db.delete(classes).where(eq(classes.ownerId, prof.id));
  await nettoyer([], [prof.id, eleve.id]);
  await rm(racine, { recursive: true, force: true });
  for (const d of dossiers) await rm(d, { recursive: true, force: true });
});

describe("vivacité et disponibilité", () => {
  it("répond à la vivacité sans dépendre de quoi que ce soit", async () => {
    const r = await application.request("http://atelier.test/api/health");

    expect(r.status).toBe(200);
    const corps = (await r.json()) as { status: string; version: string; uptime: number };
    expect(corps).toMatchObject({ status: "ok" });
    // La version permet de savoir quel artefact répond, sur une machine où
    // plusieurs versions ont pu se succéder.
    expect(corps.version).toMatch(/.+/);
    expect(corps.uptime).toBeGreaterThan(0);
  });

  it("rend le bilan de disponibilité, avec un identifiant de requête", async () => {
    const r = await application.request("http://atelier.test/api/ready");

    expect([200, 503]).toContain(r.status);
    expect(r.headers.get("x-request-id")).toMatch(/.+/);
    const bilan = (await r.json()) as { controles: unknown[] };
    expect(bilan.controles.length).toBeGreaterThan(0);
  });

  it("reprend l'identifiant de requête fourni, s'il est bien formé", async () => {
    const r = await application.request("http://atelier.test/api/health", {
      headers: { "x-request-id": "abc-123-def" },
    });
    expect(r.headers.get("x-request-id")).toBe("abc-123-def");
  });

  it("répond 404 en JSON sur une route d'API inconnue", async () => {
    const r = await application.request("http://atelier.test/api/inexistante");
    expect(r.status).toBe(404);
    await expect(r.json()).resolves.toMatchObject({ error: "Ressource introuvable" });
  });
});

describe("documents d'un tirage", () => {
  it("exige une authentification", async () => {
    const r = await commeUtilisateur(null, `/api/paper/${examId}/sujet.pdf`);
    expect(r.status).toBe(401);
  });

  it("exige un rôle enseignant", async () => {
    const r = await commeUtilisateur(eleve, `/api/paper/${examId}/sujet.pdf`);
    expect(r.status).toBe(403);
  });

  it("n'ouvre que les documents d'une liste fermée", async () => {
    // Aucun segment du chemin ne vient de l'URL : la traversée de répertoire
    // n'a pas d'endroit où s'accrocher.
    for (const nom of ["..%2F..%2Fetc%2Fpasswd", "sujet.tex", "data%2Fscoring.sqlite"]) {
      const r = await commeUtilisateur(prof, `/api/paper/${examId}/${nom}`);
      expect(r.status).toBe(404);
      await expect(r.json()).resolves.toMatchObject({ error: "Document inconnu" });
    }
  });

  it("refuse un identifiant de tirage qui n'en est pas un", async () => {
    const r = await commeUtilisateur(prof, "/api/paper/zero/sujet.pdf");
    expect(r.status).toBe(400);
  });

  it("refuse le tirage d'un collègue", async () => {
    const voisin = await creerEnseignant("Enseignant voisin documents");
    const r = await commeUtilisateur(voisin, `/api/paper/${examId}/sujet.pdf`);
    expect(r.status).toBe(404);
    await nettoyer([], [voisin.id]);
  });

  it("sert le sujet produit par AMC", async () => {
    const r = await commeUtilisateur(prof, `/api/paper/${examId}/sujet.pdf`);

    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("application/pdf");
    expect(r.headers.get("Content-Disposition")).toContain("inline");
    // Un document de tirage n'a rien à faire dans un cache partagé.
    expect(r.headers.get("Cache-Control")).toBe("private, max-age=300");
  });

  it("dit qu'un document n'a pas été produit plutôt que de rendre un fichier vide", async () => {
    const r = await commeUtilisateur(prof, `/api/paper/${examId}/catalog.pdf`);
    expect(r.status).toBe(404);
    await expect(r.json()).resolves.toMatchObject({
      error: expect.stringContaining("relancez la génération"),
    });
  });

  it("produit le relevé à la demande, en PDF et en tableur", async () => {
    const pdf = await commeUtilisateur(prof, `/api/paper/${examId}/resultats.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    // Produit maintenant : il reflète les corrections postérieures au tirage.
    expect(pdf.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThan(500);

    const csv = await commeUtilisateur(prof, `/api/paper/${examId}/resultats.csv`);
    expect(csv.status).toBe(200);
    // Un tableur se télécharge, il ne s'affiche pas dans un onglet.
    expect(csv.headers.get("Content-Disposition")).toContain("attachment");
    expect(await csv.text()).toContain("Benkhelifa");
  });
});

describe("la couche tRPC", () => {
  it("répond une erreur lisible et la consigne", async () => {
    const r = await application.request(
      "http://atelier.test/api/trpc/authoring.listEvaluations?input=%7B%7D",
    );

    // Sans session, la procédure enseignant refuse. Le client reçoit un code,
    // et le serveur en garde une trace rattachée à l'identifiant de requête.
    expect(r.status).toBe(401);
    expect(JSON.stringify(await r.json())).toContain("UNAUTHORIZED");
    expect(r.headers.get("x-request-id")).toMatch(/.+/);
  });

  it("refuse une mutation venue d'une origine étrangère", async () => {
    const r = await application.request("http://atelier.test/api/trpc/session.start", {
      method: "POST",
      headers: { origin: "https://site-tiers.exemple", "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(r.status).toBe(403);
  });
});

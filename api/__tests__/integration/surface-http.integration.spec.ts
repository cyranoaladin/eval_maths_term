/**
 * La surface HTTP du serveur.
 *
 * Tout passe par elle : identifiant de requête, CORS, protection CSRF,
 * téléchargement des documents imprimables. Ces chemins n'étaient éprouvés
 * que par des scripts exigeant un serveur démarré ; ils le sont maintenant
 * directement, en appelant l'application Hono.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import app from "../../boot";
import { signSessionToken } from "../../kimi/session";
import {
  appelEnseignant, creerEnseignant, creerEvaluation, db, nettoyer, unique,
} from "./harnais";
import { classes, paperCopies, paperExams, students } from "@db/schema";
import type { User } from "@db/schema";

const ORIGINE = "http://localhost:3000";

let prof: User;
let intrus: User;
let cookieProf: string;
let cookieIntrus: string;
let paperExamId: number;
const evaluationsCreees: number[] = [];

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant HTTP");
  intrus = await creerEnseignant("Enseignant tiers HTTP");
  cookieProf = await signSessionToken({ unionId: prof.unionId, clientId: "test" });
  cookieIntrus = await signSessionToken({ unionId: intrus.unionId, clientId: "test" });

  const api = appelEnseignant(prof);
  const ev = await creerEvaluation(prof, "Documents");
  evaluationsCreees.push(ev.evaluationId);
  const { id: classId } = await api.paper.createClass({ name: unique("Classe HTTP") });
  await api.paper.importStudents({ classId, csv: "nom;prenom\nDupont;Jean\n" });
  const eleves = await api.paper.listStudents({ classId });

  const [row] = await db.insert(paperExams).values({
    evaluationId: ev.evaluationId,
    classId,
    label: unique("Tirage HTTP"),
    status: "generated",
    createdById: prof.id,
    printedQuestionIds: ev.questionIds.slice(0, 2),
    generatedAt: new Date(),
  });
  paperExamId = Number(row.insertId);
  await db.insert(paperCopies).values({ paperExamId, studentId: eleves[0].id, copyNumber: 1 });
});

afterAll(async () => {
  await nettoyer(evaluationsCreees, []);
  for (const p of [prof, intrus]) {
    const cls = await db.select({ id: classes.id }).from(classes).where(eq(classes.ownerId, p.id));
    for (const c of cls) await db.delete(students).where(eq(students.classId, c.id));
    await db.delete(classes).where(eq(classes.ownerId, p.id));
  }
  await nettoyer([], [prof.id, intrus.id]);
});

function requete(chemin: string, init: RequestInit = {}) {
  return app.request(`${ORIGINE}${chemin}`, {
    ...init,
    headers: { origin: ORIGINE, ...(init.headers ?? {}) },
  });
}

describe("contrôle de santé", () => {
  it("répond et donne le temps de fonctionnement", async () => {
    const r = await requete("/api/health");
    expect(r.status).toBe(200);
    const corps = (await r.json()) as { status: string; uptime: number; serverTime: string };
    expect(corps.status).toBe("ok");
    expect(typeof corps.uptime).toBe("number");
    expect(Date.parse(corps.serverTime)).not.toBeNaN();
  });
});

describe("identifiant de requête", () => {
  it("en génère un et le renvoie", async () => {
    // C'est ce que l'utilisateur donne quand il signale une anomalie, et ce
    // qui mène aux journaux du serveur.
    const r = await requete("/api/health");
    const id = r.headers.get("x-request-id");
    expect(id).toBeTruthy();
    expect(id!.length).toBeGreaterThanOrEqual(8);
  });

  it("reprend celui de l'appelant quand il est bien formé", async () => {
    const r = await requete("/api/health", { headers: { "x-request-id": "trace-amont-1234" } });
    expect(r.headers.get("x-request-id")).toBe("trace-amont-1234");
  });

  it("ignore un identifiant fantaisiste plutôt que de le recopier", async () => {
    // Recopier une valeur arbitraire dans les journaux, c'est offrir une
    // injection de contenu à qui les lit. Seule une forme close est reprise ;
    // tout le reste est remplacé par un identifiant fabriqué par le serveur.
    // (Un retour à la ligne ne peut même pas être envoyé : la plateforme
    // refuse de construire l'en-tête.)
    const suspects = [
      "trace; niveau=error",
      "court",
      "a".repeat(200),
      "espace au milieu",
      "guillemet\"injecté",
    ];
    for (const valeur of suspects) {
      const r = await requete("/api/health", { headers: { "x-request-id": valeur } });
      expect(r.headers.get("x-request-id"), valeur).not.toBe(valeur);
      expect(r.headers.get("x-request-id")).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    }
  });
});

describe("routes inconnues", () => {
  it("rend une erreur JSON, pas une page", async () => {
    const r = await requete("/api/inexistant");
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error?: string }).error).toBeTruthy();
  });
});

describe("téléchargement des documents d'un tirage", () => {
  it("refuse un anonyme", async () => {
    const r = await requete(`/api/paper/${paperExamId}/sujet.pdf`);
    expect(r.status).toBe(401);
  });

  it("refuse un document qui n'est pas dans la liste close", async () => {
    // Aucun segment du chemin ne vient de l'URL : pas de traversée possible.
    const r = await requete(`/api/paper/${paperExamId}/..%2F..%2Fetc%2Fpasswd`, {
      headers: { cookie: `kimi_sid=${cookieProf}` },
    });
    expect(r.status).toBe(404);
  });

  it("refuse un identifiant de tirage qui n'en est pas un", async () => {
    const r = await requete("/api/paper/abc/sujet.pdf", {
      headers: { cookie: `kimi_sid=${cookieProf}` },
    });
    expect(r.status).toBe(400);
  });

  it("refuse le tirage d'un collègue", async () => {
    const r = await requete(`/api/paper/${paperExamId}/sujet.pdf`, {
      headers: { cookie: `kimi_sid=${cookieIntrus}` },
    });
    expect(r.status).toBe(404);
  });

  it("sert le relevé de notes au propriétaire", async () => {
    const r = await requete(`/api/paper/${paperExamId}/resultats.pdf`, {
      headers: { cookie: `kimi_sid=${cookieProf}` },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/pdf");
    const octets = Buffer.from(await r.arrayBuffer());
    expect(octets.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("sert le relevé au format tableur, en téléchargement", async () => {
    const r = await requete(`/api/paper/${paperExamId}/resultats.csv`, {
      headers: { cookie: `kimi_sid=${cookieProf}` },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/csv");
    expect(r.headers.get("content-disposition")).toMatch(/^attachment/);
    // La marque d'ordre des octets se vérifie sur les octets : `Response.text()`
    // la retire silencieusement à la décodification, comme le veut la norme.
    const octets = Buffer.from(await r.arrayBuffer());
    expect([octets[0], octets[1], octets[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(octets.toString("utf8")).toContain("N° copie");
  });

  it("signale l'absence d'un document non produit", async () => {
    // Le sujet n'a pas été généré ici : il faut le dire, pas rendre du vide.
    const r = await requete(`/api/paper/${paperExamId}/sujet.pdf`, {
      headers: { cookie: `kimi_sid=${cookieProf}` },
    });
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error?: string }).error).toMatch(/génération|produit/i);
  });
});

describe("protection contre les requêtes d'origine étrangère", () => {
  it("refuse une mutation venue d'une autre origine", async () => {
    const r = await app.request(`${ORIGINE}/api/trpc/session.start`, {
      method: "POST",
      headers: { origin: "https://site-tiers.example", "content-type": "application/json" },
      body: JSON.stringify({ json: { evaluationId: 1, studentName: "Intrus" } }),
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it("laisse passer une lecture depuis l'origine autorisée", async () => {
    const r = await requete("/api/trpc/evaluation.listPublic");
    expect(r.status).toBe(200);
  });
});

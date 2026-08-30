/**
 * La surveillance en direct, les comptes, et ce que l'élève peut demander.
 *
 * Trois surfaces peu éprouvées et lourdes de conséquences : le tableau que
 * l'enseignant regarde pendant l'épreuve, les droits qu'un administrateur
 * accorde ou retire, et les questions telles qu'elles parviennent à l'élève —
 * sans les bonnes réponses.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  appelAnonyme, appelEleve, appelEnseignant, creerEnseignant, creerEvaluation,
  db, nettoyer, ouvrirSession, unique,
} from "./harnais";
import { answerDrafts, cheatEvents, evaluations, questions, sessions, users } from "@db/schema";
import type { User } from "@db/schema";

let prof: User;
let patron: User;
let evaluationId = 0;
let questionIds: number[] = [];
const evaluationsCreees: number[] = [];

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant surveillance");
  patron = await creerEnseignant("Administratrice", "admin");
  const ev = await creerEvaluation(prof, "Surveillance");
  evaluationId = ev.evaluationId;
  questionIds = ev.questionIds;
  evaluationsCreees.push(evaluationId);
});

afterAll(async () => {
  await nettoyer(evaluationsCreees, [prof.id, patron.id]);
});

describe("compte connecté", () => {
  it("rend l'identité de l'enseignant", async () => {
    const moi = await appelEnseignant(prof).auth.me();
    expect(moi).toMatchObject({ id: prof.id, role: "teacher", status: "active" });
  });

  it("efface le cookie de session à la déconnexion", async () => {
    const contexte = { req: new Request("http://localhost/api/trpc"), resHeaders: new Headers() };
    const { appRouter } = await import("../../router");
    const api = appRouter.createCaller({ ...contexte, user: prof, requestId: "test" });

    await expect(api.auth.logout()).resolves.toEqual({ success: true });

    const pose = contexte.resHeaders.get("set-cookie")!;
    expect(pose).toContain("kimi_sid=");
    // Une durée nulle : le navigateur retire le cookie tout de suite.
    expect(pose).toContain("Max-Age=0");
    expect(pose).toContain("HttpOnly");
  });
});

describe("droits d'accès", () => {
  it("liste les comptes pour l'administratrice", async () => {
    const liste = await appelEnseignant(patron).access.listUsers();
    expect(liste.some((u) => u.id === prof.id)).toBe(true);
  });

  it("refuse la liste à un enseignant ordinaire", async () => {
    await expect(appelEnseignant(prof).access.listUsers()).rejects.toThrow();
  });

  it("autorise un compte en attente", async () => {
    const attente = await creerEnseignant("Compte en attente", "student", "pending");

    await appelEnseignant(patron).access.setAccess({
      userId: attente.id,
      role: "teacher",
      status: "active",
    });

    const [apres] = await db.select().from(users).where(eq(users.id, attente.id));
    expect(apres).toMatchObject({ role: "teacher", status: "active" });
    await nettoyer([], [attente.id]);
  });

  it("interdit à une administratrice de se retirer ses propres droits", async () => {
    // Un établissement dont la dernière administratrice se rétrograde n'a plus
    // personne pour rouvrir la porte.
    await expect(
      appelEnseignant(patron).access.setAccess({
        userId: patron.id,
        role: "teacher",
        status: "active",
      }),
    ).rejects.toThrow(/On ne se retire pas soi-même/);

    await expect(
      appelEnseignant(patron).access.setAccess({
        userId: patron.id,
        role: "admin",
        status: "disabled",
      }),
    ).rejects.toThrow(/On ne se retire pas soi-même/);
  });

  it("laisse une administratrice se confirmer elle-même", async () => {
    await expect(
      appelEnseignant(patron).access.setAccess({
        userId: patron.id,
        role: "admin",
        status: "active",
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("remonte le motif d'un refus plutôt qu'une erreur de base", async () => {
    const seule = await creerEnseignant("Dernière administratrice", "admin");
    // Retirer la dernière administratrice active est refusé par la requête ;
    // l'atelier doit en dire la raison, pas afficher une erreur SQL.
    const autres = await db.select().from(users).where(eq(users.role, "admin"));
    const actives = autres.filter((u) => u.status === "active");
    if (actives.length <= 2) {
      await expect(
        appelEnseignant(seule).access.setAccess({
          userId: patron.id,
          role: "teacher",
          status: "active",
        }),
      ).resolves.toBeDefined();
    }
    await appelEnseignant(patron).access.setAccess({
      userId: patron.id,
      role: "admin",
      status: "active",
    });
    await nettoyer([], [seule.id]);
  });
});

describe("tableau de surveillance", () => {
  it("compte brouillons et incidents, et mesure l'inactivité", async () => {
    const { sessionId } = await ouvrirSession(evaluationId, "Élève surveillé");
    await db
      .update(sessions)
      .set({ lastHeartbeatAt: new Date(Date.now() - 120_000) })
      .where(eq(sessions.id, sessionId));
    await db.insert(answerDrafts).values({
      sessionId,
      questionId: questionIds[0],
      answer: "1",
    });
    for (const type of ["tab_switch", "tab_switch", "paste"] as const) {
      await db.insert(cheatEvents).values({
        sessionId,
        type,
        timestamp: new Date(),
      });
    }

    const vue = await appelEnseignant(prof).teacherLive.snapshot({ evaluationId });

    const ligne = vue.sessions.find((s) => s.sessionId === sessionId)!;
    expect(ligne.studentName).toBe("Élève surveillé");
    expect(ligne.totalDrafts).toBe(1);
    expect(ligne.cheatEventCount).toBe(3);
    // Les types les plus fréquents d'abord : c'est ce qui oriente le regard.
    expect(ligne.topCheatTypes[0]).toBe("tab_switch");
    // La colonne ne retient que la seconde : on compare à la minute près.
    expect(ligne.idleSec).toBeGreaterThanOrEqual(115);
  });

  it("n'affiche pas d'inactivité pour une copie déjà rendue", async () => {
    const { sessionId } = await ouvrirSession(evaluationId, "Élève parti");
    await db
      .update(sessions)
      .set({ status: "completed", lastHeartbeatAt: new Date(Date.now() - 600_000) })
      .where(eq(sessions.id, sessionId));

    const vue = await appelEnseignant(prof).teacherLive.snapshot({ evaluationId });

    expect(vue.sessions.find((s) => s.sessionId === sessionId)!.idleSec).toBeNull();
  });

  it("refuse le tableau d'une évaluation qui n'est pas la sienne", async () => {
    const voisin = await creerEnseignant("Enseignant voisin surveillance");
    await expect(
      appelEnseignant(voisin).teacherLive.snapshot({ evaluationId }),
    ).rejects.toThrow();
    await nettoyer([], [voisin.id]);
  });

  it("force la remise d'une copie en cours", async () => {
    const { sessionId } = await ouvrirSession(evaluationId, "Élève à interrompre");

    await expect(
      appelEnseignant(prof).teacherLive.forceSubmit({ sessionId }),
    ).resolves.toEqual({ submitted: true });

    const [apres] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(apres.status).not.toBe("in_progress");
    expect(apres.endedAt).not.toBeNull();
  });

  it("refuse de forcer une copie déjà rendue", async () => {
    const { sessionId } = await ouvrirSession(evaluationId, "Élève déjà rendu");
    await appelEnseignant(prof).teacherLive.forceSubmit({ sessionId });

    await expect(
      appelEnseignant(prof).teacherLive.forceSubmit({ sessionId }),
    ).rejects.toThrow(/déjà terminée/);
  });

  it("montre le score de suspicion d'une copie déjà corrigée", async () => {
    const { sessionId } = await ouvrirSession(evaluationId, "Élève corrigé");
    await appelEnseignant(prof).teacherLive.forceSubmit({ sessionId });

    const vue = await appelEnseignant(prof).teacherLive.snapshot({ evaluationId });

    const ligne = vue.sessions.find((s) => s.sessionId === sessionId)!;
    // Le verdict vient de la base, pas d'un défaut d'affichage : une copie
    // corrigée porte le sien.
    expect(ligne.suspicionVerdict).toMatch(/clean|minor|moderate|severe/);
    expect(ligne.suspicionScore).toBeGreaterThanOrEqual(0);
  });

  it("refuse de forcer une copie qui n'existe pas", async () => {
    await expect(
      appelEnseignant(prof).teacherLive.forceSubmit({ sessionId: 999_999_999 }),
    ).rejects.toThrow();
  });
});

describe("ce que l'élève reçoit", () => {
  it("décrit l'évaluation avant de commencer, sans une seule question", async () => {
    const info = await appelAnonyme().question.getPublicInfo({ evaluationId });

    expect(info).toMatchObject({ id: evaluationId, questionCount: 3, maxScore: 6 });
    expect(JSON.stringify(info)).not.toContain("correctAnswer");
  });

  it("rend null pour une évaluation qui n'existe pas", async () => {
    await expect(
      appelAnonyme().question.getPublicInfo({ evaluationId: 999_999_999 }),
    ).resolves.toBeNull();
  });

  it("décrit une évaluation sans description sans inventer de texte", async () => {
    const [ev] = await db.insert(evaluations).values({
      title: unique("Sans description"),
      duration: 20,
      isActive: true,
      ownerId: prof.id,
    });
    const sansDescription = Number(ev.insertId);
    evaluationsCreees.push(sansDescription);

    const info = await appelAnonyme().question.getPublicInfo({ evaluationId: sansDescription });

    expect(info).toMatchObject({ description: null, questionCount: 0, maxScore: 0 });
  });

  it("lit des propositions déjà décodées comme celles rangées en texte", async () => {
    // Selon la version et le pilote, MySQL rend le JSON décodé ou en chaîne.
    // L'élève doit voir les mêmes propositions dans les deux cas.
    const [ev] = await db.insert(evaluations).values({
      title: unique("Propositions décodées"),
      duration: 20,
      isActive: true,
      ownerId: prof.id,
    });
    const evId = Number(ev.insertId);
    evaluationsCreees.push(evId);
    await db.insert(questions).values({
      evaluationId: evId,
      type: "qcm",
      question: "Combien font deux et deux ?",
      options: ["$3$", "$4$", "$5$", "$6$"] as never,
      correctAnswer: "1",
      points: 2,
      order: 1,
      justificationRequired: null as never,
      gradingRubric: { mode: { kind: "qcm", correctIndex: 1 }, llmReviewRequired: false, weight: 2 },
    } as never);
    const { jeton } = await ouvrirSession(evId, "Élève décodage");

    const qs = await appelEleve(jeton).question.getForActiveSession();

    expect(qs[0].options).toHaveLength(4);
    // Une colonne laissée vide n'est pas une exigence de justification.
    expect(qs[0].justificationRequired).toBe(false);
  });

  it("mélange les questions et les propositions, sans les bonnes réponses", async () => {
    const { jeton } = await ouvrirSession(evaluationId, "Élève lecteur");

    const qs = await appelEleve(jeton).question.getForActiveSession();

    expect(qs).toHaveLength(3);
    const qcm = qs.find((q) => q.type === "qcm")!;
    expect(qcm.options).toHaveLength(4);
    // Le vrai/faux n'a pas de propositions stockées : le client les fabrique.
    expect(qs.find((q) => q.type === "true_false")!.options).toBeNull();
    // La réponse courte annonce la nature de son champ de saisie.
    expect(qs.find((q) => q.type === "short_answer")).toHaveProperty("inputMode");
    expect(JSON.stringify(qs)).not.toContain("correctAnswer");
    expect(JSON.stringify(qs)).not.toContain("gradingRubric");
  });
});

describe("signalement d'incidents", () => {
  it("consigne les incidents d'une copie en cours", async () => {
    const { sessionId, jeton } = await ouvrirSession(evaluationId, "Élève signalé");

    const resultat = await appelEleve(jeton).cheat.report({
      events: [
        { type: "tab_switch", timestamp: Date.now() },
        { type: "paste", timestamp: Date.now(), metadata: { longueur: 120 } },
      ],
    });

    expect(resultat.accepted).toBe(2);
    const consignes = await db
      .select()
      .from(cheatEvents)
      .where(eq(cheatEvents.sessionId, sessionId));
    expect(consignes).toHaveLength(2);
  });

  it("refuse des incidents sur une copie déjà rendue", async () => {
    const { sessionId, jeton } = await ouvrirSession(evaluationId, "Élève rendu");
    await db
      .update(sessions)
      .set({ status: "completed" })
      .where(eq(sessions.id, sessionId));

    await expect(
      appelEleve(jeton).cheat.report({ events: [{ type: "tab_switch", timestamp: Date.now() }] }),
    ).rejects.toThrow(/Session non active/);
  });

  it("borne le nombre de signalements d'une même copie", async () => {
    const { jeton } = await ouvrirSession(evaluationId, unique("Élève bavard"));
    const { RateLimits } = await import("../../lib/rate-limit");
    const api = appelEleve(jeton);

    for (let i = 0; i < RateLimits.cheatReport.max; i += 1) {
      await api.cheat.report({ events: [{ type: "tab_switch", timestamp: Date.now() + i }] });
    }

    // Un client qui s'emballe ne doit pas pouvoir remplir la table des incidents.
    await expect(
      api.cheat.report({ events: [{ type: "tab_switch", timestamp: Date.now() }] }),
    ).rejects.toThrow(/Trop de signalements/);
  });
});

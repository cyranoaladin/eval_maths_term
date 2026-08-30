/**
 * Le parcours élève, de bout en bout, contre une vraie base.
 *
 * Ce que ces tests éprouvent et qu'aucun test unitaire ne peut voir : ce qui
 * est réellement écrit en base, ce qui en ressort, et ce que le serveur refuse
 * de laisser sortir.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  appelAnonyme, appelEleve, creerEvaluation, creerEnseignant, db, nettoyer,
  ouvrirSession, unique,
} from "./harnais";
import { responses, sessions } from "@db/schema";
import type { User } from "@db/schema";

let enseignant: User;
let evaluationId: number;
let questionIds: number[];

beforeAll(async () => {
  enseignant = await creerEnseignant("Enseignant parcours");
  const ev = await creerEvaluation(enseignant, "Parcours élève");
  evaluationId = ev.evaluationId;
  questionIds = ev.questionIds;
});

afterAll(async () => {
  await nettoyer([evaluationId], [enseignant.id]);
});

describe("avant démarrage", () => {
  it("expose le catalogue sans les énoncés", async () => {
    const liste = await appelAnonyme().evaluation.listPublic();
    const mienne = liste.find((e) => e.id === evaluationId);
    expect(mienne).toBeDefined();
    expect(JSON.stringify(mienne)).not.toContain("dérivée");
  });

  it("expose la durée et le barème, rien de plus", async () => {
    const info = await appelAnonyme().question.getPublicInfo({ evaluationId });
    expect(info?.questionCount).toBe(3);
    expect(info?.maxScore).toBe(6);
    expect(JSON.stringify(info)).not.toContain("correctAnswer");
  });

  it("refuse les énoncés sans jeton", async () => {
    await expect(appelAnonyme().question.getForActiveSession()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("session ouverte", () => {
  it("ouvre une session et sert les énoncés sans les corrections", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    const qs = await appelEleve(jeton).question.getForActiveSession();
    expect(qs).toHaveLength(3);

    const serialise = JSON.stringify(qs);
    expect(serialise).not.toContain("correctAnswer");
    expect(serialise).not.toContain("gradingRubric");
    expect(serialise).not.toContain("correctIndex");

    // La nature du champ est exposée, jamais le barème qui la produit.
    const courte = qs.find((q) => q.type === "short_answer");
    expect(courte?.inputMode).toBe("math");

    await db.delete(sessions).where(eq(sessions.id, sessionId));
  });

  it("mélange les propositions d'un QCM", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    const qs = await appelEleve(jeton).question.getForActiveSession();
    const qcm = qs.find((q) => q.type === "qcm");
    expect(qcm?.options).toHaveLength(4);
    expect(qcm?.options).toEqual(expect.arrayContaining(["$3$", "$4$", "$5$", "$6$"]));
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  });

  it("enregistre puis relit un brouillon", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    const eleve = appelEleve(jeton);
    await eleve.answer.saveDraft({ questionId: questionIds[2], answer: "2x" });
    const brouillons = await eleve.answer.listDrafts();
    expect(brouillons).toHaveLength(1);
    expect(brouillons[0].answer).toBe("2x");

    // Un second enregistrement remplace, il ne s'ajoute pas.
    await eleve.answer.saveDraft({ questionId: questionIds[2], answer: "2*x" });
    const apres = await eleve.answer.listDrafts();
    expect(apres).toHaveLength(1);
    expect(apres[0].answer).toBe("2*x");

    await nettoyerSession(sessionId);
  });

  it("répond au battement de présence avec le temps restant du serveur", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    const r = await appelEleve(jeton).session.heartbeat({
      clientTime: Date.now(),
      focused: true,
      currentQuestionIndex: 0,
      fingerprintHash: "empreinte-integration",
    });
    expect(r.expired).toBe(false);
    expect(r.remainingMs).toBeGreaterThan(0);
    await nettoyerSession(sessionId);
  });
});

describe("remise et correction", () => {
  it("corrige les trois familles de questions et scelle la session", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    const eleve = appelEleve(jeton);
    const qs = await eleve.question.getForActiveSession();

    const qcm = qs.find((q) => q.type === "qcm")!;
    const indexVu = qcm.options!.indexOf("$4$");

    const resultat = await eleve.session.submit({
      answers: [
        { questionId: qcm.id, answer: String(indexVu) },
        { questionId: qs.find((q) => q.type === "true_false")!.id, answer: "false" },
        { questionId: qs.find((q) => q.type === "short_answer")!.id, answer: "2x" },
      ],
      timeSpent: 300,
    });

    expect(resultat.success).toBe(true);
    expect(resultat.maxScore).toBe(6);
    expect(resultat.totalScore).toBe(6);
    expect(resultat.normalizedScore).toBe(20);

    // Ce qui compte : les réponses sont bien en base, avec leur mode.
    const enregistrees = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
    expect(enregistrees).toHaveLength(3);
    expect(enregistrees.map((r) => r.gradingMode).sort()).toEqual(
      ["qcm", "symbolic:literal", "true_false"].sort(),
    );

    // Le jeton de résultats donne accès à la copie, et lui seul.
    const vus = await appelAnonyme().session.getResults({ resultsToken: resultat.resultsToken });
    expect(vus.normalizedScore).toBe(20);
    await expect(
      appelAnonyme().session.getResults({ resultsToken: "jeton-forgé" }),
    ).rejects.toThrow();

    // Une session remise est close : la rendre à nouveau ne la modifie pas et
    // redonne exactement ce qu'elle avait rendu.
    const rejouee = await eleve.session.submit({ answers: [], timeSpent: 1 });
    expect(rejouee).toEqual(resultat);

    await nettoyerSession(sessionId);
  });

  it("compte zéro à une copie fausse sans échouer", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    const eleve = appelEleve(jeton);
    const qs = await eleve.question.getForActiveSession();
    const qcm = qs.find((q) => q.type === "qcm")!;
    const mauvais = qcm.options!.indexOf("$3$");

    const r = await eleve.session.submit({
      answers: [
        { questionId: qcm.id, answer: String(mauvais) },
        { questionId: qs.find((q) => q.type === "true_false")!.id, answer: "true" },
        { questionId: qs.find((q) => q.type === "short_answer")!.id, answer: "x^2" },
      ],
      timeSpent: 120,
    });
    expect(r.totalScore).toBe(0);
    expect(r.normalizedScore).toBe(0);
    await nettoyerSession(sessionId);
  });
});

async function nettoyerSession(sessionId: number) {
  const { answerDrafts, cheatEvents, gradeAudit } = await import("@db/schema");
  await db.delete(gradeAudit).where(eq(gradeAudit.sessionId, sessionId));
  await db.delete(answerDrafts).where(eq(answerDrafts.sessionId, sessionId));
  await db.delete(cheatEvents).where(eq(cheatEvents.sessionId, sessionId));
  await db.delete(responses).where(eq(responses.sessionId, sessionId));
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

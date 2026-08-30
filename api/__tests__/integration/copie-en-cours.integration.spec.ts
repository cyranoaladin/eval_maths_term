/**
 * Ce que le serveur accepte, et refuse, pendant qu'une copie se compose.
 *
 * Une session close, expirée, ou une question qui n'appartient pas à
 * l'évaluation : autant de portes qu'il ne faut pas laisser entrouvertes,
 * parce qu'elles permettraient d'écrire dans une copie qu'on n'a pas le droit
 * de toucher.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  appelEleve, creerEnseignant, creerEvaluation, db, nettoyer, ouvrirSession, unique,
} from "./harnais";
import { answerDrafts, cheatEvents, responses, sessions } from "@db/schema";
import type { User } from "@db/schema";

let prof: User;
let evaluationId: number;
let questionIds: number[];
let autreEvaluationId: number;
let autreQuestionIds: number[];

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant copies");
  const a = await creerEvaluation(prof, "Copie en cours");
  evaluationId = a.evaluationId;
  questionIds = a.questionIds;
  const b = await creerEvaluation(prof, "Autre évaluation");
  autreEvaluationId = b.evaluationId;
  autreQuestionIds = b.questionIds;
});

afterAll(async () => {
  await nettoyer([evaluationId, autreEvaluationId], [prof.id]);
});

async function effacer(sessionId: number) {
  await db.delete(answerDrafts).where(eq(answerDrafts.sessionId, sessionId));
  await db.delete(cheatEvents).where(eq(cheatEvents.sessionId, sessionId));
  await db.delete(responses).where(eq(responses.sessionId, sessionId));
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

describe("écriture d'un brouillon", () => {
  it("enregistre un brouillon et le relit", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    const eleve = appelEleve(jeton);
    await eleve.answer.saveDraft({ questionId: questionIds[2], answer: "2*x" });

    const brouillons = await eleve.answer.listDrafts();
    expect(brouillons).toHaveLength(1);
    expect(brouillons[0].answer).toBe("2*x");

    // Réécrire remplace, sans dupliquer.
    await eleve.answer.saveDraft({ questionId: questionIds[2], answer: "2x" });
    const apres = await eleve.answer.listDrafts();
    expect(apres).toHaveLength(1);
    expect(apres[0].answer).toBe("2x");

    // Un brouillon n'est pas une réponse rendue : rien n'entre dans `responses`
    // avant la remise.
    const rendues = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
    expect(rendues).toHaveLength(0);

    await effacer(sessionId);
  });

  it("refuse une question qui n'est pas dans l'évaluation de la session", async () => {
    // Sinon un élève pourrait écrire dans une évaluation qu'il ne compose pas.
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    await expect(
      appelEleve(jeton).answer.saveDraft({ questionId: autreQuestionIds[0], answer: "0" }),
    ).rejects.toThrow();
    await effacer(sessionId);
  });

  it("refuse d'écrire dans une copie déjà remise", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    await db.update(sessions).set({ status: "completed" }).where(eq(sessions.id, sessionId));

    await expect(
      appelEleve(jeton).answer.saveDraft({ questionId: questionIds[0], answer: "0" }),
    ).rejects.toThrow(/terminée/i);
    await effacer(sessionId);
  });

  it("refuse d'écrire dans une copie dont le temps est écoulé, et la scelle", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(sessions.id, sessionId));

    await expect(
      appelEleve(jeton).answer.saveDraft({ questionId: questionIds[0], answer: "0" }),
    ).rejects.toThrow(/expirée/i);

    // Le refus ne suffit pas : la copie doit passer en « temps dépassé », sans
    // quoi elle resterait « en cours » aux yeux de l'enseignant. Le brouillon
    // et la remise partageaient cette règle avec deux comportements différents.
    const [apres] = await db
      .select({ status: sessions.status })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    expect(apres.status).toBe("timed_out");
    await effacer(sessionId);
  });

  it("refuse d'écrire dans une session effacée", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    await effacer(sessionId);
    await expect(
      appelEleve(jeton).answer.saveDraft({ questionId: questionIds[0], answer: "0" }),
    ).rejects.toThrow(/introuvable/i);
  });

  it("accepte une justification à côté du brouillon", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    const eleve = appelEleve(jeton);
    await eleve.answer.saveDraft({
      questionId: questionIds[1],
      answer: "false",
      justification: "la fonction décroît sur les négatifs",
    });
    const [r] = await eleve.answer.listDrafts();
    expect(r.justification).toMatch(/décroît/);
    await effacer(sessionId);
  });
});

describe("remise d'une copie déjà commencée", () => {
  it("met à jour les réponses déjà enregistrées plutôt que d'en ajouter", async () => {
    // L'élève a répondu pendant la composition, puis remet sa copie : la
    // remise doit corriger ses réponses, pas les dupliquer.
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    const eleve = appelEleve(jeton);
    const qs = await eleve.question.getForActiveSession();
    const qcm = qs.find((q) => q.type === "qcm")!;

    // Une copie peut déjà porter des réponses en base — écrites par la saisie
    // papier, ou par une correction antérieure. La remise doit les corriger,
    // pas les dupliquer.
    await db.insert(responses).values({
      sessionId,
      questionId: qcm.id,
      answer: "0",
      maxScore: 0,
      partialCreditApplied: false,
    });
    await eleve.session.submit({
      answers: [{ questionId: qcm.id, answer: String(qcm.options!.indexOf("$4$")) }],
      timeSpent: 60,
    });

    const enregistrees = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
    expect(enregistrees).toHaveLength(1);
    expect(enregistrees[0].isCorrect).toBe(true);
    await effacer(sessionId);
  });

  it("ignore une réponse portant sur une question hors de l'évaluation", async () => {
    // Le client ne décide pas de ce qui est noté : une question étrangère
    // glissée dans la remise est écartée en silence.
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    const eleve = appelEleve(jeton);
    await eleve.session.submit({
      answers: [
        { questionId: questionIds[0], answer: "0" },
        { questionId: autreQuestionIds[0], answer: "0" },
      ],
      timeSpent: 60,
    });
    const enregistrees = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
    expect(enregistrees).toHaveLength(1);
    await effacer(sessionId);
  });

  it("n'écrit rien quand la remise ne change rien", async () => {
    // Une remise qui répète ce qui est déjà en base ne doit pas produire
    // d'écriture : c'est ce qui évite de saturer la base en fin d'épreuve.
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    const eleve = appelEleve(jeton);
    await db.insert(responses).values({
      sessionId,
      questionId: questionIds[0],
      answer: "1",
      maxScore: 0,
      partialCreditApplied: false,
    });
    const [avant] = await db.select().from(responses).where(eq(responses.sessionId, sessionId));

    await eleve.session.submit({
      answers: [{ questionId: questionIds[0], answer: "1" }],
      timeSpent: 60,
    });

    const apres = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
    expect(apres).toHaveLength(1);
    expect(apres[0].id).toBe(avant.id);
    expect(apres[0].answer).toBe("1");
    await effacer(sessionId);
  });

  it("ne remet que les questions effectivement traitées", async () => {
    // Un élève peut rendre une copie partielle : les questions absentes de la
    // remise ne doivent pas apparaître comme répondues.
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    await appelEleve(jeton).session.submit({
      answers: [{ questionId: questionIds[0], answer: "1" }],
      timeSpent: 60,
    });
    const apres = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
    expect(apres).toHaveLength(1);
    await effacer(sessionId);
  });

  it("conserve la justification remise avec la réponse", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    await appelEleve(jeton).session.submit({
      answers: [{
        questionId: questionIds[1],
        answer: "false",
        justification: "la fonction décroît sur les réels négatifs",
      }],
      timeSpent: 60,
    });
    const [r] = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
    expect(r.justification).toMatch(/décroît/);
    await effacer(sessionId);
  });
});

describe("signalements d'incidents", () => {
  it("enregistre un incident isolé", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    await appelEleve(jeton).cheat.report({
      events: [{ type: "tab_switch", timestamp: Date.now() }],
    });
    const evts = await db.select().from(cheatEvents).where(eq(cheatEvents.sessionId, sessionId));
    expect(evts.length).toBeGreaterThanOrEqual(1);
    await effacer(sessionId);
  });

  it("regroupe des incidents identiques rapprochés", async () => {
    // Un changement d'onglet produit plusieurs signaux en quelques
    // millisecondes : les compter séparément gonflerait le score de suspicion.
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    const eleve = appelEleve(jeton);
    const t = Date.now();
    await eleve.cheat.report({
      events: [
        { type: "blur", timestamp: t },
        { type: "blur", timestamp: t + 50 },
        { type: "blur", timestamp: t + 100 },
      ],
    });
    const evts = await db.select().from(cheatEvents).where(eq(cheatEvents.sessionId, sessionId));
    expect(evts.length).toBeLessThan(3);
    await effacer(sessionId);
  });

  it("refuse un lot vide", async () => {
    // Le contrat exige au moins un incident : un lot vide est un appel inutile,
    // et l'accepter ouvrirait une voie de sollicitation gratuite du serveur.
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    await expect(appelEleve(jeton).cheat.report({ events: [] })).rejects.toThrow();
    const evts = await db.select().from(cheatEvents).where(eq(cheatEvents.sessionId, sessionId));
    expect(evts).toHaveLength(0);
    await effacer(sessionId);
  });

  it("plafonne la taille d'un lot", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Élève"));
    const t = Date.now();
    const trop = Array.from({ length: 51 }, (_, i) => ({
      type: "blur" as const, timestamp: t + i * 1000,
    }));
    await expect(appelEleve(jeton).cheat.report({ events: trop })).rejects.toThrow();
    await effacer(sessionId);
  });
});

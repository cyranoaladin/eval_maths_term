/**
 * Deux remises de la même copie, en même temps.
 *
 * Le cas n'est pas théorique : un élève qui double-clique, un navigateur qui
 * rejoue une requête après une coupure, un onglet resté ouvert. Ce qui compte
 * est qu'il n'en résulte jamais une copie corrompue — pas de réponse en double,
 * pas de note comptée deux fois, pas d'audit inventé, et un état final que
 * l'enseignant peut lire.
 *
 * Les deux issues sont acceptables : la seconde remise est sans effet, ou elle
 * est refusée. Ce qui ne l'est pas, c'est qu'elle soit acceptée à moitié.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  appelAnonyme, appelEleve, creerEnseignant, creerEvaluation, db, nettoyer,
  ouvrirSession, unique,
} from "./harnais";
import { autoSubmitSession } from "../../anticheat/auto-submit";
import { answerDrafts, cheatEvents, gradeAudit, responses, sessions } from "@db/schema";
import type { User } from "@db/schema";

let prof: User;
let evaluationId: number;

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant concurrence");
  const ev = await creerEvaluation(prof, "Remise concurrente");
  evaluationId = ev.evaluationId;
});

afterAll(async () => {
  await nettoyer([evaluationId], [prof.id]);
});

async function effacer(sessionId: number) {
  await db.delete(gradeAudit).where(eq(gradeAudit.sessionId, sessionId));
  await db.delete(answerDrafts).where(eq(answerDrafts.sessionId, sessionId));
  await db.delete(cheatEvents).where(eq(cheatEvents.sessionId, sessionId));
  await db.delete(responses).where(eq(responses.sessionId, sessionId));
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/** Prépare une copie remplie, prête à être remise. */
async function copiePrete() {
  const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Concurrent"));
  const eleve = appelEleve(jeton);
  const qs = await eleve.question.getForActiveSession();
  const qcm = qs.find((q) => q.type === "qcm")!;
  const reponses = [
    { questionId: qcm.id, answer: String(qcm.options!.indexOf("$4$")) },
    { questionId: qs.find((q) => q.type === "true_false")!.id, answer: "false" },
    { questionId: qs.find((q) => q.type === "short_answer")!.id, answer: "2x" },
  ];
  return { jeton, sessionId, reponses, eleve };
}

/** État de la copie tel qu'un enseignant le verrait. */
async function etatDeLaCopie(sessionId: number) {
  const lignes = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  const journal = await db.select().from(gradeAudit).where(eq(gradeAudit.sessionId, sessionId));
  return { lignes, session: s, journal };
}

describe("deux remises simultanées de la même copie", () => {
  it("ne produit jamais de copie corrompue", async () => {
    const { jeton, sessionId, reponses } = await copiePrete();
    const eleve = appelEleve(jeton);

    const [a, b] = await Promise.allSettled([
      eleve.session.submit({ answers: reponses, timeSpent: 300 }),
      eleve.session.submit({ answers: reponses, timeSpent: 300 }),
    ]);

    const abouties = [a, b].filter((r) => r.status === "fulfilled");
    expect(abouties.length, "au moins une remise doit aboutir").toBeGreaterThanOrEqual(1);

    const { lignes, session, journal } = await etatDeLaCopie(sessionId);

    // Une seule réponse par question : c'est la contrainte d'unicité qui le
    // garantit, quel que soit l'entrelacement.
    expect(lignes).toHaveLength(3);
    const couples = lignes.map((l) => l.questionId);
    expect(new Set(couples).size).toBe(couples.length);

    // La note n'est pas comptée deux fois.
    expect(Number(session.totalScore)).toBe(6);
    expect(Number(session.maxScore)).toBe(6);
    expect(Number(session.normalizedScore)).toBe(20);

    // La copie est close, et le journal n'a rien inventé.
    expect(session.status).not.toBe("in_progress");
    expect(journal.filter((j) => j.action === "manual_override")).toHaveLength(0);

    await effacer(sessionId);
  });

  it("rend un état déterministe quelle que soit l'issue de la seconde", async () => {
    // Les deux comportements admis — sans effet, ou refusée — laissent la même
    // copie derrière eux.
    for (let essai = 0; essai < 3; essai++) {
      const { jeton, sessionId, reponses } = await copiePrete();
      const eleve = appelEleve(jeton);

      const resultats = await Promise.allSettled([
        eleve.session.submit({ answers: reponses, timeSpent: 300 }),
        eleve.session.submit({ answers: reponses, timeSpent: 300 }),
      ]);
      const refusees = resultats.filter((r) => r.status === "rejected");
      // Une remise refusée doit l'être parce que la copie est déjà rendue,
      // jamais parce que la base a buté sur une contrainte.
      for (const r of refusees) {
        const message = String((r as PromiseRejectedResult).reason);
        expect(message, message).toMatch(/terminée|introuvable|expirée/i);
      }

      const { lignes, session } = await etatDeLaCopie(sessionId);
      expect(lignes, `essai ${essai}`).toHaveLength(3);
      expect(Number(session.totalScore), `essai ${essai}`).toBe(6);
      await effacer(sessionId);
    }
  });

  it("rejoue une remise perdue en réseau et rend exactement la même réponse", async () => {
    /*
      Le cas n'a rien d'exotique : la copie est écrite et corrigée, la réponse
      HTTP se perd — wifi d'établissement, onglet fermé trop vite, navigateur
      qui rejoue — et le client réessaie.

      L'élève recevait « cette session est déjà terminée » : sa copie était bel
      et bien rendue, mais sans note et sans jeton de résultats, il ne pouvait
      plus la consulter, et rien ne le lui disait. Une remise déjà faite se
      redonne, elle ne se refuse pas.
    */
    const { jeton, sessionId, reponses } = await copiePrete();
    const eleve = appelEleve(jeton);

    const premiere = await eleve.session.submit({ answers: reponses, timeSpent: 300 });
    const avant = await etatDeLaCopie(sessionId);

    const seconde = await eleve.session.submit({ answers: reponses, timeSpent: 300 });

    // Mot pour mot la même réponse : mêmes points, même jeton de résultats.
    expect(seconde).toEqual(premiere);

    // Et la copie n'a pas bougé — y compris sa date de fin, qui est l'instant
    // où l'élève a rendu, pas celui où la correction s'est achevée.
    const apres = await etatDeLaCopie(sessionId);
    expect(apres.lignes).toHaveLength(avant.lignes.length);
    expect(Number(apres.session.totalScore)).toBe(Number(avant.session.totalScore));
    expect(apres.session.status).toBe(avant.session.status);
    expect(apres.session.endedAt?.getTime()).toBe(avant.session.endedAt?.getTime());

    // Le jeton rendu ouvre bien les résultats : c'est tout l'enjeu pour l'élève.
    const resultats = await appelAnonyme().session.getResults({
      resultsToken: seconde.resultsToken,
    });
    expect(resultats.totalScore).toBe(premiere.totalScore);

    await effacer(sessionId);
  });

  it("rend ses résultats à l'élève dont la copie a été remise automatiquement", async () => {
    // Remise après inactivité, ou forcée par l'enseignant : la remise tardive
    // de l'élève ne doit rien écraser, et doit tout de même lui ouvrir sa copie.
    const { jeton, sessionId, reponses } = await copiePrete();
    const eleve = appelEleve(jeton);
    await eleve.answer.saveDraft({
      questionId: reponses[0].questionId,
      answer: reponses[0].answer,
    });

    await autoSubmitSession(sessionId, { reason: "manual_force" });
    const apresAuto = await etatDeLaCopie(sessionId);

    const tardive = await eleve.session.submit({ answers: reponses, timeSpent: 300 });

    const apres = await etatDeLaCopie(sessionId);
    expect(apres.session.status).toBe(apresAuto.session.status);
    expect(Number(apres.session.totalScore)).toBe(Number(apresAuto.session.totalScore));
    expect(apres.lignes).toHaveLength(apresAuto.lignes.length);

    const resultats = await appelAnonyme().session.getResults({
      resultsToken: tardive.resultsToken,
    });
    expect(resultats.sessionId).toBe(sessionId);

    await effacer(sessionId);
  });

  it("empêche une seconde réponse à la même question, même hors remise", async () => {
    // La garantie vient de la base : elle tient quel que soit le chemin
    // applicatif emprunté.
    const { jeton, sessionId, reponses } = await copiePrete();
    await appelEleve(jeton).session.submit({ answers: reponses, timeSpent: 300 });
    const [premiere] = await db.select().from(responses).where(eq(responses.sessionId, sessionId));

    // Drizzle enveloppe l'erreur du pilote : c'est la cause qu'il faut lire.
    let refus: unknown;
    try {
      await db.insert(responses).values({
        sessionId,
        questionId: premiere.questionId,
        answer: "réponse en double",
      });
    } catch (e) {
      refus = e;
    }
    expect(refus, "la base doit refuser la seconde réponse").toBeDefined();
    const chaine = [
      String(refus),
      String((refus as { cause?: unknown })?.cause ?? ""),
    ].join(" ");
    expect(chaine).toMatch(/duplicate|ER_DUP_ENTRY|uq_responses_session_question/i);

    // Et la copie reste intacte.
    const apres = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
    expect(apres).toHaveLength(3);

    await effacer(sessionId);
  });
});

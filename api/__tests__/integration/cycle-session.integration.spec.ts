/**
 * Le cycle de vie d'une session d'évaluation.
 *
 * Ouvrir, composer, remettre — et tout ce que le serveur doit refuser autour :
 * une évaluation fermée, un temps écoulé, une copie déjà rendue, un nom qui
 * s'acharne. Ces règles décident si un élève peut composer ou non ; aucune ne
 * doit dépendre du client.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  appelAnonyme, appelEleve, creerEnseignant, creerEvaluation, db, nettoyer,
  ouvrirSession, unique,
} from "./harnais";
import { answerDrafts, cheatEvents, evaluations, responses, sessions } from "@db/schema";
import { RateLimits } from "../../lib/rate-limit";
import type { User } from "@db/schema";

let prof: User;
let evaluationId: number;
let fermeeId: number;

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant cycle");
  const ev = await creerEvaluation(prof, "Cycle de session");
  evaluationId = ev.evaluationId;
  const fermee = await creerEvaluation(prof, "Évaluation close");
  fermeeId = fermee.evaluationId;
  await db.update(evaluations).set({ isActive: false }).where(eq(evaluations.id, fermeeId));
});

afterAll(async () => {
  await nettoyer([evaluationId, fermeeId], [prof.id]);
});

async function effacer(sessionId: number) {
  await db.delete(answerDrafts).where(eq(answerDrafts.sessionId, sessionId));
  await db.delete(cheatEvents).where(eq(cheatEvents.sessionId, sessionId));
  await db.delete(responses).where(eq(responses.sessionId, sessionId));
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

describe("ouverture", () => {
  it("ouvre une session et renvoie de quoi composer", async () => {
    const r = await appelAnonyme().session.start({
      evaluationId,
      studentName: unique("Ouvre"),
    });
    expect(r.sessionId).toBeGreaterThan(0);
    expect(r.sessionToken).toBeTruthy();
    expect(new Date(r.expiresAt).getTime()).toBeGreaterThan(new Date(r.serverTime).getTime());
    await effacer(r.sessionId);
  });

  it("refuse une évaluation qui n'est pas ouverte", async () => {
    // Une évaluation désactivée par l'enseignant ne doit plus se composer.
    await expect(
      appelAnonyme().session.start({ evaluationId: fermeeId, studentName: unique("Refusé") }),
    ).rejects.toThrow();
  });

  it("refuse une évaluation qui n'existe pas", async () => {
    await expect(
      appelAnonyme().session.start({ evaluationId: 99_999_999, studentName: unique("Fantôme") }),
    ).rejects.toThrow();
  });

  it("borne les ouvertures répétées sous le même nom", async () => {
    // La limite vise la personne qui s'acharne, pas la salle : c'est le même
    // nom, sur la même évaluation, qui déclenche le refus.
    const nom = unique("Insistant");
    const ouvertes: number[] = [];
    let refus = "";
    for (let i = 0; i < RateLimits.sessionStart.max + 2; i++) {
      try {
        const r = await appelAnonyme().session.start({ evaluationId, studentName: nom });
        ouvertes.push(r.sessionId);
      } catch (e) {
        refus = e instanceof Error ? e.message : String(e);
        break;
      }
    }
    expect(ouvertes.length).toBeLessThanOrEqual(RateLimits.sessionStart.max);
    expect(refus).toMatch(/tentatives/i);
    for (const id of ouvertes) await effacer(id);
  });
});

describe("remise", () => {
  it("refuse une remise après expiration et scelle la copie", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Retardataire"));
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, sessionId));

    await expect(
      appelEleve(jeton).session.submit({ answers: [], timeSpent: 10 }),
    ).rejects.toThrow(/expirée/i);

    // Le serveur ne se contente pas de refuser : il ferme la session, sans
    // quoi elle resterait indéfiniment ouverte dans la surveillance.
    const [apres] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(apres.status).toBe("timed_out");
    await effacer(sessionId);
  });

  it("refuse une remise sur une session effacée", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Disparu"));
    await effacer(sessionId);
    await expect(
      appelEleve(jeton).session.submit({ answers: [], timeSpent: 10 }),
    ).rejects.toThrow(/introuvable/i);
  });

  it("redonne la première remise plutôt que de refuser la seconde", async () => {
    // Une copie déjà rendue ne se rend pas deux fois — mais la refuser laissait
    // l'élève sans note et sans jeton de résultats quand la réponse s'était
    // simplement perdue en chemin.
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Deux fois"));
    const premiere = await appelEleve(jeton).session.submit({ answers: [], timeSpent: 10 });
    const seconde = await appelEleve(jeton).session.submit({ answers: [], timeSpent: 10 });
    expect(seconde).toEqual(premiere);
    await effacer(sessionId);
  });
});

describe("résultats", () => {
  it("refuse un jeton de résultats forgé ou vide", async () => {
    await expect(appelAnonyme().session.getResults({ resultsToken: "" })).rejects.toThrow();
    await expect(
      appelAnonyme().session.getResults({ resultsToken: "a.b.c" }),
    ).rejects.toThrow(/invalide|expiré/i);
  });

  it("refuse un jeton dont la session a disparu", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Éphémère"));
    const r = await appelEleve(jeton).session.submit({ answers: [], timeSpent: 10 });
    await effacer(sessionId);
    await expect(
      appelAnonyme().session.getResults({ resultsToken: r.resultsToken }),
    ).rejects.toThrow(/introuvable/i);
  });
});

describe("battement de présence", () => {
  it("dit au client qu'une session close est close", async () => {
    // Le battement ne refuse pas : il rend l'état réel de la session. C'est ce
    // qui permet à la copie ouverte dans un onglet oublié de se rendre compte
    // qu'elle a été remise ailleurs, plutôt que de rester à composer dans le
    // vide.
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Fermé"));
    await db.update(sessions).set({ status: "completed" }).where(eq(sessions.id, sessionId));
    const r = await appelEleve(jeton).session.heartbeat({
      clientTime: Date.now(), focused: true, currentQuestionIndex: 0, fingerprintHash: "e",
    });
    expect(r.status).toBe("completed");
    await effacer(sessionId);
  });
});

/**
 * La remise automatique d'une copie abandonnée.
 *
 * Une copie qu'on n'a pas rendue doit quand même être corrigée sur ce qui a
 * été écrit. Les droits de l'élève sur ses données sont éprouvés à part, dans
 * `saisie-et-rgpd` : ils tiennent à la même fonction et méritaient un seul
 * endroit plutôt que deux moitiés.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  appelEleve, creerEnseignant, creerEvaluation, db, nettoyer, ouvrirSession, unique,
} from "./harnais";
import { autoSubmitSession } from "../../anticheat/auto-submit";
import {
  answerDrafts, cheatEvents, classes, evaluations, questions, responses,
  sessions, students,
} from "@db/schema";
import type { User } from "@db/schema";

let prof: User;
let evaluationId: number;
const evaluationsCreees: number[] = [];

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant remise");
  const ev = await creerEvaluation(prof, "Remise automatique");
  evaluationId = ev.evaluationId;
  evaluationsCreees.push(evaluationId);
});

afterAll(async () => {
  await nettoyer(evaluationsCreees, []);
  const cls = await db.select({ id: classes.id }).from(classes).where(eq(classes.ownerId, prof.id));
  for (const c of cls) await db.delete(students).where(eq(students.classId, c.id));
  await db.delete(classes).where(eq(classes.ownerId, prof.id));
  await nettoyer([], [prof.id]);
});

async function effacer(sessionId: number) {
  await db.delete(answerDrafts).where(eq(answerDrafts.sessionId, sessionId));
  await db.delete(cheatEvents).where(eq(cheatEvents.sessionId, sessionId));
  await db.delete(responses).where(eq(responses.sessionId, sessionId));
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

describe("remise automatique après abandon", () => {
  it("corrige ce qui avait été écrit avant la coupure", async () => {
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Abandon"));
    const eleve = appelEleve(jeton);
    const qs = await eleve.question.getForActiveSession();
    const qcm = qs.find((q) => q.type === "qcm")!;

    await eleve.answer.saveDraft({ questionId: qcm.id, answer: String(qcm.options!.indexOf("$4$")) });
    await eleve.answer.saveDraft({
      questionId: qs.find((q) => q.type === "short_answer")!.id, answer: "2x",
    });

    await autoSubmitSession(sessionId, { reason: "idle_disconnect" });

    const [apres] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(apres.status).toBe("auto_submitted_idle");
    // Les brouillons sont devenus des réponses notées.
    const notees = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
    expect(notees).toHaveLength(2);
    expect(Number(apres.totalScore)).toBeGreaterThan(0);

    // L'abandon pèse sur le verdict : une copie interrompue n'est pas
    // « propre ».
    expect(apres.suspicionScore).toBeGreaterThan(0);
    expect(apres.suspicionVerdict).not.toBe("clean");

    await effacer(sessionId);
  });

  it("remet une copie restée blanche sans échouer", async () => {
    const { sessionId } = await ouvrirSession(evaluationId, unique("Blanche"));
    await autoSubmitSession(sessionId, { reason: "idle_disconnect" });
    const [apres] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(apres.status).toBe("auto_submitted_idle");
    expect(Number(apres.normalizedScore)).toBe(0);
    await effacer(sessionId);
  });

  it("ne fait rien sur une copie déjà remise", async () => {
    // Le balayage peut repasser sur la même session : il doit être sans effet.
    const { jeton, sessionId } = await ouvrirSession(evaluationId, unique("Déjà rendue"));
    await appelEleve(jeton).session.submit({ answers: [], timeSpent: 10 });
    const [avant] = await db.select().from(sessions).where(eq(sessions.id, sessionId));

    await autoSubmitSession(sessionId, { reason: "idle_disconnect" });
    const [apres] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(apres.status).toBe(avant.status);
    expect(apres.endedAt?.getTime()).toBe(avant.endedAt?.getTime());
    await effacer(sessionId);
  });

  it("refuse une session qui n'existe pas", async () => {
    await expect(
      autoSubmitSession(99_999_999, { reason: "idle_disconnect" }),
    ).rejects.toThrow(/introuvable/i);
  });

  it("ne compte pas l'abandon quand la remise est forcée par l'enseignant", async () => {
    // Une remise décidée par le surveillant n'est pas un incident de l'élève.
    const { sessionId } = await ouvrirSession(evaluationId, unique("Forcée"));
    await autoSubmitSession(sessionId, { reason: "manual_force" });
    const evts = await db.select().from(cheatEvents).where(eq(cheatEvents.sessionId, sessionId));
    expect(evts.filter((e) => e.type === "idle_disconnect")).toHaveLength(0);
    await effacer(sessionId);
  });
});

describe("ce que la remise automatique sait traverser", () => {
  it("remet la copie même si une question a été retirée pendant l'épreuve", async () => {
    const ev = await creerEvaluation(prof, "Question retirée");
    evaluationsCreees.push(ev.evaluationId);
    const { jeton, sessionId } = await ouvrirSession(ev.evaluationId, unique("Orpheline"));
    const eleve = appelEleve(jeton);
    const qs = await eleve.question.getForActiveSession();
    for (const q of qs.slice(0, 2)) {
      await eleve.answer.saveDraft({ questionId: q.id, answer: "1" });
    }

    // La suppression emporte le brouillon avec elle — la clé étrangère est en
    // cascade. Ce qui reste doit tout de même être corrigé et rendu.
    await db.delete(questions).where(eq(questions.id, qs[1].id));
    expect(
      await db.select().from(answerDrafts).where(eq(answerDrafts.sessionId, sessionId)),
    ).toHaveLength(1);

    await autoSubmitSession(sessionId, { reason: "idle_disconnect" });

    const [apres] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(apres.status).toBe("auto_submitted_idle");
    const notees = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
    expect(notees).toHaveLength(1);
    await effacer(sessionId);
  });

  it("laisse à l'enseignant ce que le moteur ne peut pas trancher seul", async () => {
    const [ev] = await db.insert(evaluations).values({
      title: unique("Avec justification"),
      duration: 30,
      isActive: true,
      ownerId: prof.id,
    });
    const evaluationId2 = Number(ev.insertId);
    evaluationsCreees.push(evaluationId2);
    const [q] = await db.insert(questions).values({
      evaluationId: evaluationId2,
      type: "short_answer",
      question: "Justifier la convergence de la suite.",
      correctAnswer: "récurrence",
      points: 4,
      order: 1,
      gradingRubric: {
        mode: { kind: "text", expected: ["récurrence"] },
        llmReviewRequired: true,
        weight: 4,
      },
    } as never);
    const questionId = Number(q.insertId);
    const { jeton, sessionId } = await ouvrirSession(evaluationId2, unique("À relire"));
    await appelEleve(jeton).answer.saveDraft({
      questionId,
      answer: "Par récurrence",
      justification: "La propriété est vraie au rang 0 et se transmet.",
    });

    await autoSubmitSession(sessionId, { reason: "idle_disconnect" });

    const [notee] = await db.select().from(responses).where(eq(responses.sessionId, sessionId));
    // La remise automatique ne fait pas appel au modèle : la copie attend une
    // relecture humaine plutôt que de recevoir une note improvisée.
    expect(notee.llmFeedback).toMatch(/corriger manuellement/);
    expect(notee.justification).toMatch(/rang 0/);
    await effacer(sessionId);
  });

  it("ne divise pas par zéro sur une évaluation sans barème", async () => {
    const [ev] = await db.insert(evaluations).values({
      title: unique("Sans points"),
      duration: 30,
      isActive: true,
      ownerId: prof.id,
    });
    const evaluationId3 = Number(ev.insertId);
    evaluationsCreees.push(evaluationId3);
    await db.insert(questions).values({
      evaluationId: evaluationId3,
      type: "qcm",
      question: "Question hors barème",
      options: JSON.stringify(["A", "B"]),
      correctAnswer: "0",
      points: 0,
      order: 1,
      gradingRubric: { mode: { kind: "qcm", correctIndex: 0 }, llmReviewRequired: false, weight: 0 },
    } as never);
    const { sessionId } = await ouvrirSession(evaluationId3, unique("Sans barème"));

    await autoSubmitSession(sessionId, { reason: "idle_disconnect" });

    const [apres] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(Number(apres.normalizedScore)).toBe(0);
    await effacer(sessionId);
  });
});

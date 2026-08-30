/**
 * La remise automatique d'une copie abandonnée, et les droits de l'élève sur
 * ses données.
 *
 * Une copie qu'on n'a pas rendue doit quand même être corrigée sur ce qui a
 * été écrit : c'est ce que garantit la remise automatique. Et un élève — ou sa
 * famille — doit pouvoir obtenir ce que la plateforme sait de lui, puis en
 * demander l'effacement.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  appelEleve, appelEnseignant, creerEnseignant, creerEvaluation, db, nettoyer,
  ouvrirSession, unique,
} from "./harnais";
import { autoSubmitSession } from "../../anticheat/auto-submit";
import { exportStudentData, anonymizeStudent } from "../../paper/student-data";
import {
  answerDrafts, cheatEvents, classes, paperCopies, paperExams, responses,
  sessions, students,
} from "@db/schema";
import type { User } from "@db/schema";

let prof: User;
let evaluationId: number;
let questionIds: number[];
let evaluationsCreees: number[] = [];

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant remise");
  const ev = await creerEvaluation(prof, "Remise automatique");
  evaluationId = ev.evaluationId;
  questionIds = ev.questionIds;
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

describe("données personnelles d'un élève", () => {
  async function eleveAvecCopie() {
    const api = appelEnseignant(prof);
    const { id: classId } = await api.paper.createClass({ name: unique("Classe RGPD") });
    await api.paper.importStudents({ classId, csv: "nom;prenom\nDurand;Léa\n" });
    const [eleve] = await api.paper.listStudents({ classId });

    const [row] = await db.insert(paperExams).values({
      evaluationId,
      classId,
      label: unique("Tirage RGPD"),
      status: "generated",
      createdById: prof.id,
      printedQuestionIds: questionIds.slice(0, 2),
      generatedAt: new Date(),
    });
    const paperExamId = Number(row.insertId);
    await db.insert(paperCopies).values({ paperExamId, studentId: eleve.id, copyNumber: 1 });
    await api.paper.saveEntry({
      paperExamId,
      studentId: eleve.id,
      answers: questionIds.slice(0, 2).map((q) => ({ questionId: q, choiceIndex: 1 })),
    });
    return { eleve, paperExamId, classId };
  }

  it("rend tout ce que la plateforme sait de l'élève", async () => {
    const { eleve } = await eleveAvecCopie();
    const donnees = await exportStudentData(eleve.id);
    const texte = JSON.stringify(donnees);
    expect(texte).toMatch(/Léa/);
    // Ses copies et ses notes en font partie : un export qui n'en dit rien
    // ne répond pas à la demande.
    expect(texte).toMatch(/Durand/);
    expect(donnees).toBeTruthy();
  });

  it("refuse d'exporter un élève inexistant", async () => {
    await expect(exportStudentData(99_999_999)).rejects.toThrow();
  });

  it("efface l'identité en conservant les notes", async () => {
    // L'effacement ne doit pas détruire la moyenne de la classe : c'est le
    // nom qui disparaît, pas le résultat.
    const { eleve, paperExamId } = await eleveAvecCopie();
    const avant = await appelEnseignant(prof).paper.results({ paperExamId });
    const moyenneAvant = avant.stats.average;

    await anonymizeStudent(eleve.id);

    const [apres] = await db.select().from(students).where(eq(students.id, eleve.id));
    expect(`${apres.firstName} ${apres.lastName}`).not.toMatch(/Léa/);

    const resultats = await appelEnseignant(prof).paper.results({ paperExamId });
    expect(resultats.stats.average).toBe(moyenneAvant);
  });

  it("refuse d'anonymiser un élève inexistant", async () => {
    await expect(anonymizeStudent(99_999_999)).rejects.toThrow();
  });
});

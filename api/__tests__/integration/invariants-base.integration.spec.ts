/**
 * Ce que la base refuse, quoi qu'il arrive.
 *
 * Certaines règles ne peuvent pas être tenues par une vérification applicative :
 * entre le SELECT qui constate et l'INSERT qui écrit, une seconde requête passe.
 * Sur une salle d'examen, cette seconde requête existe — deux surveillants qui
 * saisissent le même paquet, un enseignant qui valide deux fois, un client qui
 * rejoue après une coupure.
 *
 * Ces tests écrivent directement en base, sans passer par l'application : c'est
 * la seule façon de prouver que la garantie ne dépend d'aucun chemin applicatif.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  appelEnseignant, creerEnseignant, creerEvaluation, db, nettoyer, unique,
} from "./harnais";
import { paperCopies, paperExams, questions, sessions, students, classes } from "@db/schema";
import type { User } from "@db/schema";

let prof: User;
let evaluationId: number;
let questionIds: number[];
let classId: number;
let elevesIds: number[];
let paperExamId: number;

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant invariants");
  const ev = await creerEvaluation(prof, "Invariants");
  evaluationId = ev.evaluationId;
  questionIds = ev.questionIds;

  const api = appelEnseignant(prof);
  const classe = await api.paper.createClass({ name: unique("Classe invariants") });
  classId = classe.id;
  await api.paper.importStudents({ classId, csv: "nom;prenom\nDupont;Jean\nMartin;Alice\n" });
  elevesIds = (await api.paper.listStudents({ classId })).map((e) => e.id);

  const [tirage] = await db.insert(paperExams).values({
    evaluationId,
    classId,
    label: unique("Tirage invariants"),
    status: "generated",
    createdById: prof.id,
    printedQuestionIds: questionIds.slice(0, 2),
  });
  paperExamId = Number(tirage.insertId);
});

afterAll(async () => {
  await db.delete(paperCopies).where(eq(paperCopies.paperExamId, paperExamId));
  await db.delete(paperExams).where(eq(paperExams.id, paperExamId));
  if (elevesIds.length) await db.delete(students).where(inArray(students.id, elevesIds));
  await db.delete(classes).where(eq(classes.id, classId));
  await nettoyer([evaluationId], [prof.id]);
});

/** Le message d'une erreur de contrainte, cause du pilote comprise. */
function motif(e: unknown): string {
  return [String(e), String((e as { cause?: unknown })?.cause ?? "")].join(" ");
}

describe("un élève n'a qu'une copie par tirage", () => {
  it("la base refuse la seconde", async () => {
    // Sans cette contrainte : deux notes pour un même élève sur une même
    // épreuve, un relevé qui en compte deux, une moyenne faussée.
    await db.insert(paperCopies).values({
      paperExamId,
      studentId: elevesIds[0],
      copyNumber: 1,
    });

    let refus: unknown;
    try {
      await db.insert(paperCopies).values({
        paperExamId,
        studentId: elevesIds[0],
        copyNumber: 2,
      });
    } catch (e) {
      refus = e;
    }

    expect(refus, "la seconde copie doit être refusée").toBeDefined();
    expect(motif(refus)).toMatch(/duplicate|ER_DUP_ENTRY|uq_paper_copies_exam_eleve/i);

    const restantes = await db
      .select()
      .from(paperCopies)
      .where(eq(paperCopies.paperExamId, paperExamId));
    expect(restantes).toHaveLength(1);
  });

  it("laisse passer un autre élève du même tirage", async () => {
    await db.insert(paperCopies).values({
      paperExamId,
      studentId: elevesIds[1],
      copyNumber: 2,
    });
    const restantes = await db
      .select()
      .from(paperCopies)
      .where(eq(paperCopies.paperExamId, paperExamId));
    expect(restantes).toHaveLength(2);
  });
});

describe("une session corrigée n'appartient qu'à une copie", () => {
  it("la base refuse de la rattacher deux fois", async () => {
    // Sans cette contrainte, la même note serait portée par deux élèves.
    const [session] = await db.insert(sessions).values({
      evaluationId,
      studentName: unique("Copie papier"),
      mode: "paper",
    });
    const sessionId = Number(session.insertId);

    await db
      .update(paperCopies)
      .set({ sessionId })
      .where(eq(paperCopies.studentId, elevesIds[0]));

    let refus: unknown;
    try {
      await db
        .update(paperCopies)
        .set({ sessionId })
        .where(eq(paperCopies.studentId, elevesIds[1]));
    } catch (e) {
      refus = e;
    }

    expect(refus, "la seconde attache doit être refusée").toBeDefined();
    expect(motif(refus)).toMatch(/duplicate|ER_DUP_ENTRY|uq_paper_copies_session/i);

    await db.update(paperCopies).set({ sessionId: null }).where(eq(paperCopies.paperExamId, paperExamId));
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  });

  it("accepte plusieurs copies sans session", async () => {
    // Une copie non saisie n'a pas de session : la contrainte ne doit pas
    // interdire d'en avoir plusieurs.
    const sans = await db
      .select()
      .from(paperCopies)
      .where(eq(paperCopies.paperExamId, paperExamId));
    expect(sans.filter((c) => c.sessionId === null)).toHaveLength(2);
  });
});

describe("une question occupe une place unique dans son évaluation", () => {
  it("la base refuse un doublon d'ordre", async () => {
    // L'ordre décide de la numérotation imprimée et de la grille de saisie.
    const [existante] = await db
      .select()
      .from(questions)
      .where(eq(questions.id, questionIds[0]));

    let refus: unknown;
    try {
      await db.insert(questions).values({
        evaluationId,
        type: "qcm",
        question: "Une seconde question à la même place",
        options: ["a", "b"],
        correctAnswer: "0",
        points: 1,
        order: existante.order,
      });
    } catch (e) {
      refus = e;
    }

    expect(refus, "la question en doublon doit être refusée").toBeDefined();
    expect(motif(refus)).toMatch(/duplicate|ER_DUP_ENTRY|uq_questions_evaluation_ordre/i);
  });

  it("laisse la même place libre dans une autre évaluation", async () => {
    const autre = await creerEvaluation(prof, "Autre évaluation invariants");
    const [q] = await db.select().from(questions).where(eq(questions.id, autre.questionIds[0]));
    expect(q).toBeDefined();
    await nettoyer([autre.evaluationId], []);
  });
});

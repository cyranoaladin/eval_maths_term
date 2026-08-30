/**
 * Le relevé construit depuis la base, et l'évaluation de référence.
 *
 * `buildReleve` rassemble ce que l'enseignant voit sur le document remis :
 * une ligne par élève de la classe, sa note, et la mention d'une éventuelle
 * reprise manuelle. Il ne s'éprouve qu'avec de vraies lignes en base.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  appelEnseignant, creerEnseignant, creerEvaluation, db, nettoyer, unique,
} from "./harnais";
import { buildReleve } from "../../paper/results-pdf";
import { renderReleveCsv } from "../../paper/results-csv";
import { classes, evaluations, paperCopies, paperExams, students } from "@db/schema";
import type { User } from "@db/schema";

let prof: User;
let evaluationsCreees: number[] = [];

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant relevé");
});

afterAll(async () => {
  await nettoyer(evaluationsCreees, []);
  const cls = await db.select({ id: classes.id }).from(classes).where(eq(classes.ownerId, prof.id));
  for (const c of cls) await db.delete(students).where(eq(students.classId, c.id));
  await db.delete(classes).where(eq(classes.ownerId, prof.id));
  await nettoyer([], [prof.id]);
});

async function tirageSaisi() {
  const api = appelEnseignant(prof);
  const ev = await creerEvaluation(prof, "Relevé");
  evaluationsCreees.push(ev.evaluationId);

  const { id: classId } = await api.paper.createClass({ name: unique("Classe relevé") });
  await api.paper.importStudents({
    classId,
    csv: "nom;prenom\nBenkhelifa-Prévost;Aïcha\nO'Sullivan;Chloé\nAbsent;Paul\n",
  });
  const eleves = await api.paper.listStudents({ classId });

  const imprimees = ev.questionIds.slice(0, 2);
  const [row] = await db.insert(paperExams).values({
    evaluationId: ev.evaluationId,
    classId,
    label: unique("Tirage relevé"),
    status: "generated",
    createdById: prof.id,
    printedQuestionIds: imprimees,
    generatedAt: new Date(),
  });
  const paperExamId = Number(row.insertId);
  for (const [i, e] of eleves.entries()) {
    await db.insert(paperCopies).values({ paperExamId, studentId: e.id, copyNumber: i + 1 });
  }

  // Deux copies saisies, une laissée blanche : c'est la situation ordinaire.
  await api.paper.saveEntry({
    paperExamId, studentId: eleves[0].id,
    answers: imprimees.map((q) => ({ questionId: q, choiceIndex: 1 })),
  });
  await api.paper.saveEntry({
    paperExamId, studentId: eleves[1].id,
    answers: imprimees.map((q) => ({ questionId: q, choiceIndex: 0 })),
  });

  return { paperExamId, classId, eleves, evaluationId: ev.evaluationId };
}

describe("buildReleve", () => {
  it("porte une ligne par élève de la classe", async () => {
    const t = await tirageSaisi();
    const releve = await buildReleve(t.paperExamId);
    expect(releve.lignes).toHaveLength(3);
    expect(releve.lignes.map((l) => l.nom).join(" ")).toMatch(/Aïcha/);
    expect(releve.classe).toBeTruthy();
    expect(releve.evaluation).toBeTruthy();
  });

  it("distingue une copie non rendue d'un zéro", async () => {
    const t = await tirageSaisi();
    const releve = await buildReleve(t.paperExamId);
    const absente = releve.lignes.find((l) => !l.saisie);
    const zero = releve.lignes.find((l) => l.saisie && l.note20 === 0);
    expect(absente?.note20).toBeNull();
    expect(zero?.note20).toBe(0);
    expect(releve.stats.saisies).toBe(2);
    expect(releve.stats.total).toBe(3);
  });

  it("calcule moyenne, minimum et maximum sur les seules copies rendues", async () => {
    const t = await tirageSaisi();
    const releve = await buildReleve(t.paperExamId);
    expect(releve.stats.max).toBe(20);
    expect(releve.stats.min).toBe(0);
    expect(releve.stats.moyenne).toBe(10);
  });

  it("ne signale une reprise manuelle que lorsqu'il y en a une", async () => {
    const t = await tirageSaisi();
    const avant = await buildReleve(t.paperExamId);
    expect(avant.lignes.some((l) => l.interventionManuelle)).toBe(false);

    // Une saisie papier ordinaire n'est pas une reprise : seule une
    // intervention explicite de l'enseignant en est une.
    const api = appelEnseignant(prof);
    const copies = await db
      .select()
      .from(paperCopies)
      .where(eq(paperCopies.paperExamId, t.paperExamId));
    const avecSession = copies.find((c) => c.sessionId !== null)!;
    const detail = await api.session.getDetailsForTeacher({ sessionId: avecSession.sessionId! });
    await api.grading2.overrideGrade({
      responseId: detail.responses[0].id,
      score: 1,
      reason: "Copie relue après réclamation",
    });

    const apres = await buildReleve(t.paperExamId);
    expect(apres.lignes.filter((l) => l.interventionManuelle)).toHaveLength(1);
  });

  it("alimente le relevé au format tableur", async () => {
    const t = await tirageSaisi();
    const csv = renderReleveCsv(await buildReleve(t.paperExamId));
    expect(csv).toMatch(/Aïcha/);
    expect(csv).toMatch(/Moyenne \/20;10,00/);
  });

  it("refuse un tirage inexistant", async () => {
    await expect(buildReleve(99_999_999)).rejects.toThrow();
  });
});

describe("évaluation de référence", () => {
  it("se sème et reste idempotente", async () => {
    const api = appelEnseignant(prof);
    const premier = await api.evaluation.seed();
    const second = await api.evaluation.seed();
    expect(second.evaluationId).toBe(premier.evaluationId);

    const detail = await api.authoring.getEvaluation({ id: premier.evaluationId });
    expect(detail.questions.length).toBeGreaterThan(0);

    // Semée par un autre appel, l'évaluation appartient à qui l'a demandée :
    // on la laisse en place, elle sert de référence commune.
    const restantes = await db
      .select({ id: evaluations.id })
      .from(evaluations)
      .where(inArray(evaluations.id, [premier.evaluationId]));
    expect(restantes).toHaveLength(1);
  });
});

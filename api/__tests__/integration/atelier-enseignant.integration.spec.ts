/**
 * L'atelier de l'enseignant, contre une vraie base.
 *
 * Rédiger, dupliquer, constituer une classe, saisir des copies papier, lire
 * les résultats — et, à chaque étape, ne pas atteindre ce qui appartient à un
 * collègue. C'est le cœur du produit et c'est ce qui n'était éprouvé que par
 * des scripts exigeant un serveur démarré.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  appelEnseignant, creerEnseignant, creerEvaluation, db, nettoyer, unique,
} from "./harnais";
import { classes, paperCopies, paperExams, students } from "@db/schema";
import type { User } from "@db/schema";
import type { GradingRubric } from "@contracts/grading-rubric";

let prof: User;
let intrus: User;
const evaluationsCreees: number[] = [];

const barèmeQcm = (correctIndex: number, poids: number): GradingRubric => ({
  mode: { kind: "qcm", correctIndex },
  llmReviewRequired: false,
  weight: poids,
});

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant atelier");
  intrus = await creerEnseignant("Enseignant tiers");
});

afterAll(async () => {
  // L'ordre suit les clés étrangères : les copies papier référencent les
  // élèves, qui référencent les classes. `nettoyer` s'occupe des tirages ;
  // restent les classes et leurs élèves.
  await nettoyer(evaluationsCreees, []);
  for (const proprietaire of [prof, intrus]) {
    const cls = await db.select({ id: classes.id }).from(classes).where(eq(classes.ownerId, proprietaire.id));
    for (const c of cls) {
      await db.delete(students).where(eq(students.classId, c.id));
    }
    await db.delete(classes).where(eq(classes.ownerId, proprietaire.id));
  }
  await nettoyer([], [prof.id, intrus.id]);
});

describe("rédaction", () => {
  it("crée une évaluation et la retrouve dans sa liste", async () => {
    const api = appelEnseignant(prof);
    const titre = unique("Contrôle de suites");
    const { id } = await api.authoring.createEvaluation({ title: titre, duration: 45 });
    evaluationsCreees.push(id);

    const liste = await api.authoring.listEvaluations();
    expect(liste.some((e) => e.id === id)).toBe(true);

    const detail = await api.authoring.getEvaluation({ id });
    expect(detail.evaluation.title).toBe(titre);
    expect(detail.questions).toHaveLength(0);
  });

  it("ajoute une question cohérente et refuse une question qui ne l'est pas", async () => {
    const api = appelEnseignant(prof);
    const { id } = await api.authoring.createEvaluation({ title: unique("Cohérence") });
    evaluationsCreees.push(id);

    await api.authoring.createQuestion({
      evaluationId: id,
      question: {
        type: "qcm",
        question: "Combien font deux et deux ?",
        options: ["$3$", "$4$", "$5$", "$6$"],
        correctAnswer: "1",
        points: 2,
        gradingRubric: barèmeQcm(1, 2),
      },
    });

    // La fiche annonce une réponse, le barème en corrige une autre : c'est le
    // barème qui note, donc l'incohérence doit être refusée à la rédaction.
    await expect(
      api.authoring.createQuestion({
        evaluationId: id,
        question: {
          type: "qcm",
          question: "Combien font trois et trois ?",
          options: ["$5$", "$6$"],
          correctAnswer: "0",
          points: 2,
          gradingRubric: barèmeQcm(1, 2),
        },
      }),
    ).rejects.toThrow();

    const detail = await api.authoring.getEvaluation({ id });
    expect(detail.questions).toHaveLength(1);
  });

  it("modifie une évaluation et une question", async () => {
    const api = appelEnseignant(prof);
    const { id } = await api.authoring.createEvaluation({ title: unique("À modifier") });
    evaluationsCreees.push(id);
    const q = await api.authoring.createQuestion({
      evaluationId: id,
      question: {
        type: "qcm", question: "Question initiale", options: ["$1$", "$2$"],
        correctAnswer: "0", points: 1, gradingRubric: barèmeQcm(0, 1),
      },
    });

    await api.authoring.updateEvaluation({ id, title: "Titre corrigé", duration: 90, isActive: false });
    await api.authoring.updateQuestion({
      id: q.id,
      question: {
        type: "qcm", question: "Question corrigée", options: ["$1$", "$2$"],
        correctAnswer: "1", points: 3, gradingRubric: barèmeQcm(1, 3),
      },
    });

    const detail = await api.authoring.getEvaluation({ id });
    expect(detail.evaluation.title).toBe("Titre corrigé");
    expect(detail.evaluation.duration).toBe(90);
    expect(detail.questions[0].question).toBe("Question corrigée");
    expect(detail.questions[0].points).toBe(3);
  });

  it("accepte tous les renseignements facultatifs d'une question", async () => {
    // Étiquettes, difficulté, illustration et justification obligatoire : rien
    // n'est requis, mais tout doit être conservé quand c'est renseigné.
    const api = appelEnseignant(prof);
    const { id } = await api.authoring.createEvaluation({
      title: unique("Complète"), description: "Avec tout", duration: 30,
      deliveryMode: "both", subject: "Mathématiques", level: "Terminale",
    });
    evaluationsCreees.push(id);

    await api.authoring.createQuestion({
      evaluationId: id,
      question: {
        type: "true_false",
        question: "La suite est croissante.",
        correctAnswer: "true",
        justificationRequired: true,
        points: 2,
        tags: ["suites", "monotonie"],
        difficulty: 3,
        imageUrl: "https://exemple.test/figure.png",
        gradingRubric: {
          mode: { kind: "true_false", correctValue: "true" },
          llmReviewRequired: false,
          weight: 2,
        },
      },
    });

    const detail = await api.authoring.getEvaluation({ id });
    const q = detail.questions[0];
    expect(q.justificationRequired).toBe(true);
    expect(q.difficulty).toBe(3);
    expect(q.tags).toEqual(["suites", "monotonie"]);
    expect(q.imageUrl).toContain("figure.png");
  });

  it("efface un renseignement facultatif quand on le vide", async () => {
    const api = appelEnseignant(prof);
    const { id } = await api.authoring.createEvaluation({
      title: unique("À vider"), description: "Une description", subject: "Maths",
    });
    evaluationsCreees.push(id);
    await api.authoring.updateEvaluation({ id, description: null, subject: null, level: null });
    const detail = await api.authoring.getEvaluation({ id });
    expect(detail.evaluation.description).toBeNull();
    expect(detail.evaluation.subject).toBeNull();
  });

  it("refuse de supprimer une question d'une évaluation qui n'est pas la sienne", async () => {
    const mienne = await creerEvaluation(prof, "Protégée question");
    evaluationsCreees.push(mienne.evaluationId);
    await expect(
      appelEnseignant(intrus).authoring.deleteQuestion({ id: mienne.questionIds[0] }),
    ).rejects.toThrow();
  });

  it("supprime une question de sa propre évaluation", async () => {
    const api = appelEnseignant(prof);
    const ev = await creerEvaluation(prof, "Question jetable");
    evaluationsCreees.push(ev.evaluationId);
    await api.authoring.deleteQuestion({ id: ev.questionIds[0] });
    const detail = await api.authoring.getEvaluation({ id: ev.evaluationId });
    expect(detail.questions).toHaveLength(2);
  });

  it("duplique une évaluation avec ses questions", async () => {
    const api = appelEnseignant(prof);
    const source = await creerEvaluation(prof, "À dupliquer");
    evaluationsCreees.push(source.evaluationId);

    const copie = await api.authoring.duplicateEvaluation({ id: source.evaluationId });
    evaluationsCreees.push(copie.id);

    const detail = await api.authoring.getEvaluation({ id: copie.id });
    expect(detail.questions).toHaveLength(3);
    expect(detail.evaluation.id).not.toBe(source.evaluationId);
  });

  it("supprime une évaluation vierge", async () => {
    const api = appelEnseignant(prof);
    const { id } = await api.authoring.createEvaluation({ title: unique("Jetable") });
    await api.authoring.deleteEvaluation({ id });
    await expect(api.authoring.getEvaluation({ id })).rejects.toThrow();
  });

  it("n'atteint pas l'évaluation d'un collègue", async () => {
    const aMoi = await creerEvaluation(prof, "Privée");
    evaluationsCreees.push(aMoi.evaluationId);
    const autre = appelEnseignant(intrus);

    await expect(autre.authoring.getEvaluation({ id: aMoi.evaluationId })).rejects.toThrow();
    await expect(
      autre.authoring.updateEvaluation({ id: aMoi.evaluationId, title: "Détournée" }),
    ).rejects.toThrow();
    await expect(autre.authoring.deleteEvaluation({ id: aMoi.evaluationId })).rejects.toThrow();
  });

  it("annonce si la rédaction assistée est disponible", async () => {
    const r = await appelEnseignant(prof).authoring.llmStatus();
    expect(typeof r.configured).toBe("boolean");
  });
});

describe("classes et listes d'élèves", () => {
  it("importe une liste depuis un fichier de vie scolaire", async () => {
    const api = appelEnseignant(prof);
    const { id: classId } = await api.paper.createClass({
      name: unique("Terminale"), level: "Terminale", subject: "Mathématiques",
    });

    const imp = await api.paper.importStudents({
      classId,
      csv: "nom;prenom\nBenkhelifa-Prévost;Aïcha\nO'Sullivan;Chloé\nKjærgaard;Søren\n",
    });
    expect(imp.inserted).toBe(3);

    const liste = await api.paper.listStudents({ classId });
    expect(liste).toHaveLength(3);
    // Les accents et les apostrophes traversent l'import intacts.
    const noms = liste.map((e) => `${e.firstName} ${e.lastName}`).join(" ");
    expect(noms).toMatch(/Aïcha/);
    expect(noms).toMatch(/O'Sullivan/);
  });

  it("remplace une liste quand on le demande", async () => {
    const api = appelEnseignant(prof);
    const { id: classId } = await api.paper.createClass({ name: unique("Remplacée") });
    await api.paper.importStudents({ classId, csv: "nom;prenom\nDupont;Jean\n" });
    await api.paper.importStudents({ classId, csv: "nom;prenom\nMartin;Claire\n", replace: true });

    const liste = await api.paper.listStudents({ classId });
    expect(liste).toHaveLength(1);
    expect(`${liste[0].firstName} ${liste[0].lastName}`).toMatch(/Claire/);
  });

  it("liste les classes de l'enseignant, pas celles des autres", async () => {
    const api = appelEnseignant(prof);
    const nom = unique("Visible");
    await api.paper.createClass({ name: nom });

    expect((await api.paper.listClasses()).some((c) => c.name === nom)).toBe(true);
    expect((await appelEnseignant(intrus).paper.listClasses()).some((c) => c.name === nom)).toBe(false);
  });

  it("refuse d'ouvrir la classe d'un collègue", async () => {
    const { id: classId } = await appelEnseignant(prof).paper.createClass({ name: unique("Fermée") });
    await expect(appelEnseignant(intrus).paper.listStudents({ classId })).rejects.toThrow();
    await expect(
      appelEnseignant(intrus).paper.importStudents({ classId, csv: "nom;prenom\nX;Y\n" }),
    ).rejects.toThrow();
  });

  it("crée une classe avec ses seuls renseignements obligatoires", async () => {
    // Niveau, matière et année scolaire sont facultatifs : une classe créée à
    // la volée en cours d'année ne doit pas exiger de les remplir.
    const api = appelEnseignant(prof);
    const { id } = await api.paper.createClass({ name: unique("Minimale") });
    const liste = await api.paper.listClasses();
    const creee = liste.find((c) => c.id === id)!;
    expect(creee.level).toBeNull();
    expect(creee.subject).toBeNull();
  });

  it("ignore les lignes inutilisables d'une liste et signale les doublons", async () => {
    // Un fichier de vie scolaire contient des en-têtes, des lignes vides et
    // parfois deux fois le même élève : rien de tout cela ne doit faire échouer
    // l'import.
    const api = appelEnseignant(prof);
    const { id: classId } = await api.paper.createClass({ name: unique("Liste brute") });
    const premier = await api.paper.importStudents({
      classId,
      csv: "nom;prenom\nDupont;Jean\n\n;\nMartin;Claire\n",
    });
    expect(premier.inserted).toBe(2);

    // Réimporter la même liste sans « remplacer » n'ajoute personne.
    const second = await api.paper.importStudents({
      classId,
      csv: "nom;prenom\nDupont;Jean\nMartin;Claire\n",
    });
    expect(second.inserted).toBe(0);
    expect(second.alreadyPresent).toBe(2);
    expect(await api.paper.listStudents({ classId })).toHaveLength(2);
  });

  it("refuse une liste dont aucune colonne ne porte de nom", async () => {
    const api = appelEnseignant(prof);
    const { id: classId } = await api.paper.createClass({ name: unique("Illisible") });
    await expect(
      api.paper.importStudents({ classId, csv: "colonne_a;colonne_b\n1;2\n" }),
    ).rejects.toThrow();
  });

  it("annonce si l'impression est disponible sur ce serveur", async () => {
    const r = await appelEnseignant(prof).paper.status();
    expect(typeof r.amcAvailable).toBe("boolean");
  });
});

describe("droits des élèves sur leurs données", () => {
  it("exporte les données d'un élève puis les anonymise", async () => {
    const api = appelEnseignant(prof);
    const { id: classId } = await api.paper.createClass({ name: unique("RGPD") });
    await api.paper.importStudents({ classId, csv: "nom;prenom\nDurand;Léa\n" });
    const [eleve] = await api.paper.listStudents({ classId });

    const donnees = await api.paper.exportStudentData({ studentId: eleve.id });
    expect(JSON.stringify(donnees)).toMatch(/Léa/);

    await api.paper.anonymizeStudent({ studentId: eleve.id });
    const apres = await api.paper.listStudents({ classId });
    expect(JSON.stringify(apres)).not.toMatch(/Léa/);
  });

  it("refuse l'export d'un élève qui n'est pas dans ses classes", async () => {
    const api = appelEnseignant(prof);
    const { id: classId } = await api.paper.createClass({ name: unique("Cloisonnée") });
    await api.paper.importStudents({ classId, csv: "nom;prenom\nRoux;Paul\n" });
    const [eleve] = await api.paper.listStudents({ classId });

    await expect(
      appelEnseignant(intrus).paper.exportStudentData({ studentId: eleve.id }),
    ).rejects.toThrow();
    await expect(
      appelEnseignant(intrus).paper.anonymizeStudent({ studentId: eleve.id }),
    ).rejects.toThrow();
  });
});

describe("saisie des copies papier", () => {
  /**
   * Le tirage est inscrit directement en base : produire les documents exige
   * `auto-multiple-choice` et une chaîne LaTeX complète, ce que la recette
   * Docker vérifie pour de vrai. Ce qui est éprouvé ici est la suite — la
   * grille de saisie, la notation, les résultats.
   */
  async function tirage(): Promise<{ paperExamId: number; classId: number; evaluationId: number; questionIds: number[]; studentIds: number[] }> {
    const api = appelEnseignant(prof);
    const ev = await creerEvaluation(prof, "Devoir sur table");
    evaluationsCreees.push(ev.evaluationId);

    const { id: classId } = await api.paper.createClass({ name: unique("Classe papier") });
    await api.paper.importStudents({
      classId,
      csv: "nom;prenom\nPremier;Élève\nSecond;Élève\n",
    });
    const eleves = await api.paper.listStudents({ classId });

    // Seules les deux questions à cases sont imprimables : la réponse courte
    // se corrige à la main.
    const imprimees = ev.questionIds.slice(0, 2);
    const [row] = await db.insert(paperExams).values({
      evaluationId: ev.evaluationId,
      classId,
      label: unique("Tirage"),
      status: "generated",
      createdById: prof.id,
      printedQuestionIds: imprimees,
      generatedAt: new Date(),
    });
    const paperExamId = Number(row.insertId);
    // Une copie numérotée par élève, comme le fait la génération réelle : le
    // numéro est ce que l'enseignant lit sur le papier au moment de saisir.
    for (const [i, eleve] of eleves.entries()) {
      await db.insert(paperCopies).values({
        paperExamId,
        studentId: eleve.id,
        copyNumber: i + 1,
      });
    }
    return {
      paperExamId,
      classId,
      evaluationId: ev.evaluationId,
      questionIds: imprimees,
      studentIds: eleves.map((e) => e.id),
    };
  }

  it("rend une grille alignée sur ce qui a été imprimé", async () => {
    const t = await tirage();
    const grille = await appelEnseignant(prof).paper.entrySheet({ paperExamId: t.paperExamId });
    expect(grille.questions.map((q) => q.id)).toEqual(t.questionIds);
    expect(grille.copies).toHaveLength(2);
  });

  it("note une copie juste et une copie fausse", async () => {
    const t = await tirage();
    const api = appelEnseignant(prof);
    const grille = await api.paper.entrySheet({ paperExamId: t.paperExamId });

    const juste = await api.paper.saveEntry({
      paperExamId: t.paperExamId,
      studentId: t.studentIds[0],
      answers: [
        { questionId: t.questionIds[0], choiceIndex: 1 },
        { questionId: t.questionIds[1], choiceIndex: 1 },
      ],
    });
    expect(juste.normalizedScore).toBe(20);

    const faux = await api.paper.saveEntry({
      paperExamId: t.paperExamId,
      studentId: t.studentIds[1],
      answers: [
        { questionId: t.questionIds[0], choiceIndex: 0 },
        { questionId: t.questionIds[1], choiceIndex: 0 },
      ],
    });
    expect(faux.normalizedScore).toBe(0);

    const res = await api.paper.results({ paperExamId: t.paperExamId });
    expect(res.stats.entered).toBe(2);
    expect(res.stats.average).toBe(10);
    expect(grille.copies).toHaveLength(2);
  });

  it("accepte une copie blanche sans la confondre avec un zéro non saisi", async () => {
    const t = await tirage();
    const api = appelEnseignant(prof);
    await api.paper.saveEntry({
      paperExamId: t.paperExamId,
      studentId: t.studentIds[0],
      answers: [
        { questionId: t.questionIds[0], choiceIndex: null },
        { questionId: t.questionIds[1], choiceIndex: null },
      ],
    });
    const res = await api.paper.results({ paperExamId: t.paperExamId });
    expect(res.stats.entered).toBe(1);
    expect(res.rows.filter((r) => !r.entered)).toHaveLength(1);
  });

  it("accepte les points d'une question rédigée saisis à la main", async () => {
    // Les questions rédigées ne sont pas sur la grille de cases : l'enseignant
    // les note en lisant la copie, et ces points doivent entrer dans le total.
    const t = await tirage();
    const api = appelEnseignant(prof);
    const ev = await api.authoring.getEvaluation({
      id: (await db.select().from(paperExams).where(eq(paperExams.id, t.paperExamId)))[0].evaluationId,
    });
    const redigee = ev.questions.find((q) => q.type === "short_answer")!;

    const r = await api.paper.saveEntry({
      paperExamId: t.paperExamId,
      studentId: t.studentIds[0],
      answers: t.questionIds.map((q) => ({ questionId: q, choiceIndex: 1 })),
      openMarks: [{ questionId: redigee.id, score: 2 }],
    });
    // Trois points de cases plus deux points attribués à la main.
    expect(r.totalScore).toBe(5);
    expect(r.maxScore).toBe(6);
  });

  it("liste les tirages d'une évaluation et le panorama de l'atelier", async () => {
    const t = await tirage();
    const api = appelEnseignant(prof);
    const liste = await api.paper.listExams({ evaluationId: t.evaluationId });
    expect(liste.some((e) => e.id === t.paperExamId)).toBe(true);

    const vue = await api.paper.overview({ limite: 5 });
    expect(Array.isArray(vue.tirages)).toBe(true);
  });

  it("refuse la grille d'un tirage jamais imprimé", async () => {
    // Un tirage sans composition figée ne peut pas être saisi : mieux vaut le
    // dire que d'ouvrir une grille inventée, qui produirait de fausses notes.
    const ev = await creerEvaluation(prof, "Non imprimé");
    evaluationsCreees.push(ev.evaluationId);
    const api = appelEnseignant(prof);
    const { id: classId } = await api.paper.createClass({ name: unique("Sans tirage") });
    const [row] = await db.insert(paperExams).values({
      evaluationId: ev.evaluationId, classId, label: unique("Brouillon"),
      status: "draft", createdById: prof.id,
    });
    await expect(
      api.paper.entrySheet({ paperExamId: Number(row.insertId) }),
    ).rejects.toThrow(/généré|imprimé/i);
  });

  it("refuse de saisir la copie d'un élève absent du tirage", async () => {
    const t = await tirage();
    const api = appelEnseignant(prof);
    const { id: autreClasse } = await api.paper.createClass({ name: unique("Ailleurs") });
    await api.paper.importStudents({ classId: autreClasse, csv: "nom;prenom\nÉtranger;Paul\n" });
    const [etranger] = await api.paper.listStudents({ classId: autreClasse });

    await expect(
      api.paper.saveEntry({
        paperExamId: t.paperExamId,
        studentId: etranger.id,
        answers: [{ questionId: t.questionIds[0], choiceIndex: 0 }],
      }),
    ).rejects.toThrow();
  });

  it("rend des résultats vides plutôt qu'une erreur quand rien n'est saisi", async () => {
    const t = await tirage();
    const res = await appelEnseignant(prof).paper.results({ paperExamId: t.paperExamId });
    expect(res.stats.entered).toBe(0);
    expect(res.stats.average).toBeNull();
    expect(res.rows.every((r) => !r.entered)).toBe(true);
  });

  it("ne liste aucun tirage pour une évaluation qui n'en a pas", async () => {
    const ev = await creerEvaluation(prof, "Jamais imprimée");
    evaluationsCreees.push(ev.evaluationId);
    const liste = await appelEnseignant(prof).paper.listExams({ evaluationId: ev.evaluationId });
    expect(liste).toHaveLength(0);
  });

  it("refuse le tirage d'un collègue", async () => {
    const t = await tirage();
    const autre = appelEnseignant(intrus);
    await expect(autre.paper.entrySheet({ paperExamId: t.paperExamId })).rejects.toThrow();
    await expect(autre.paper.results({ paperExamId: t.paperExamId })).rejects.toThrow();
    await expect(
      autre.paper.saveEntry({
        paperExamId: t.paperExamId,
        studentId: t.studentIds[0],
        answers: [{ questionId: t.questionIds[0], choiceIndex: 1 }],
      }),
    ).rejects.toThrow();
  });
});

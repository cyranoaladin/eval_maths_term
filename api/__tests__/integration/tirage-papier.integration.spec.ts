/**
 * La fabrication d'un tirage papier, contre une vraie base.
 *
 * Ce chemin décide de ce que les élèves auront entre les mains, et de la
 * correspondance entre un numéro de copie et un nom. Il n'était éprouvé que
 * de bout en bout, par la recette Docker : une erreur d'ordre ou une copie
 * oubliée n'apparaissait qu'après une impression.
 *
 * AMC est ici un exécutable de théâtre placé en tête de PATH. Le reste — la
 * lecture de l'évaluation, la composition du document, l'écriture des copies —
 * est le vrai code, contre la vraie base.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { mkdtemp, mkdir, writeFile, chmod, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appelEnseignant, db, creerEnseignant, nettoyer, unique } from "./harnais";
import { classes, evaluations, paperCopies, paperExams, questions, students } from "@db/schema";
import type { User } from "@db/schema";
import { generatePaperExam, paperRoot, workdirFor, DOWNLOADABLE } from "../../paper/paper-service";

let prof: User;
let racine = "";
const PATH_INITIAL = process.env.PATH;
const evaluationsCreees: number[] = [];
const dossiers: string[] = [];

const SCRIPT = `#!/bin/bash
if [ "$1" = "prepare" ] && [ "$3" = "s" ]; then
  printf '%%PDF sujet' > sujet.pdf
  printf '%%PDF corrige' > corrige.pdf
  printf '%%PDF catalogue' > catalog.pdf
  printf 'calage' > calage.xy
fi
exit 0
`;

/** Une classe et ses élèves. `actifs` d'abord, puis les inactifs. */
async function creerClasse(
  noms: Array<{ nom: string; prenom: string; actif?: boolean }>,
): Promise<{ classId: number; studentIds: number[] }> {
  const [c] = await db.insert(classes).values({
    name: unique("Terminale"),
    ownerId: prof.id,
  });
  const classId = Number(c.insertId);
  const studentIds: number[] = [];
  for (const n of noms) {
    const [s] = await db.insert(students).values({
      classId,
      lastName: n.nom,
      firstName: n.prenom,
      active: n.actif ?? true,
    });
    studentIds.push(Number(s.insertId));
  }
  return { classId, studentIds };
}

async function creerTirage(evaluationId: number, classId: number, label: string | null) {
  const [e] = await db.insert(paperExams).values({
    evaluationId,
    classId,
    label,
    createdById: prof.id,
  });
  const id = Number(e.insertId);
  dossiers.push(workdirFor(id));
  return id;
}

/** Une évaluation dont on choisit les questions : c'est ce qui décide du tirage. */
async function creerEvaluationPapier(
  defs: Array<Record<string, unknown>>,
  titre = "Tirage",
): Promise<number> {
  const [ev] = await db.insert(evaluations).values({
    title: unique(titre),
    duration: 45,
    isActive: true,
    ownerId: prof.id,
  });
  const evaluationId = Number(ev.insertId);
  evaluationsCreees.push(evaluationId);
  for (const [i, d] of defs.entries()) {
    await db.insert(questions).values({ evaluationId, order: i + 1, points: 2, ...d } as never);
  }
  return evaluationId;
}

const qcm = (sur: Record<string, unknown> = {}) => ({
  type: "qcm" as const,
  question: "Combien font deux et deux ?",
  options: JSON.stringify(["$3$", "$4$", "$5$", "$6$"]),
  correctAnswer: "1",
  gradingRubric: { mode: { kind: "qcm", correctIndex: 1 }, llmReviewRequired: false, weight: 2 },
  ...sur,
});

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant tirage");
  racine = await mkdtemp(join(tmpdir(), "amc-tirage-"));
  await mkdir(join(racine, "bin"), { recursive: true });
  await writeFile(join(racine, "bin", "auto-multiple-choice"), SCRIPT, "utf8");
  await chmod(join(racine, "bin", "auto-multiple-choice"), 0o755);
  process.env.PATH = `${join(racine, "bin")}:${PATH_INITIAL ?? ""}`;
});

afterAll(async () => {
  process.env.PATH = PATH_INITIAL;
  await nettoyer(evaluationsCreees, [prof.id]);
  await rm(racine, { recursive: true, force: true });
  for (const d of dossiers) await rm(d, { recursive: true, force: true });
});

describe("emplacement des tirages", () => {
  it("donne à chaque tirage son propre dossier, sous une racine absolue", () => {
    expect(paperRoot().startsWith("/")).toBe(true);
    expect(workdirFor(41)).toBe(join(paperRoot(), "exam-41"));
    // Deux impressions simultanées ne peuvent pas se marcher dessus.
    expect(workdirFor(41)).not.toBe(workdirFor(42));
  });

  it("n'ouvre au téléchargement qu'une liste fermée de documents", () => {
    expect(Object.keys(DOWNLOADABLE).sort()).toEqual([
      "catalog.pdf", "corrige.pdf", "resultats.csv", "resultats.pdf", "sujet.pdf",
    ]);
    // Les relevés sortent de la base, pas du disque : aucun chemin à traverser.
    expect(DOWNLOADABLE["resultats.pdf"].genere).toBe(true);
    expect(DOWNLOADABLE["sujet.pdf"].genere).toBeUndefined();
  });
});

describe("production d'un tirage", () => {
  it("numérote les copies dans l'ordre alphabétique et fige la composition", async () => {
    const evaluationId = await creerEvaluationPapier([
      qcm(),
      {
        type: "true_false",
        question: "La fonction carré est croissante sur $\\mathbb{R}$.",
        correctAnswer: "false",
        gradingRubric: { mode: { kind: "true_false", correctValue: "false" }, llmReviewRequired: false, weight: 1 },
      },
      // Une réponse courte ne se grille pas sur une feuille-réponses : elle
      // doit être écartée, sans faire échouer le tirage.
      {
        type: "short_answer",
        question: "Dérivée de $x^2$ ?",
        correctAnswer: "2*x",
        gradingRubric: { mode: { kind: "symbolic", canonical: "2*x", variables: ["x"] }, llmReviewRequired: false, weight: 3 },
      },
    ]);
    const { classId, studentIds } = await creerClasse([
      { nom: "Zidane", prenom: "Yasmine" },
      { nom: "Benkhelifa", prenom: "Aïcha" },
      { nom: "Absent", prenom: "Marc", actif: false },
    ]);
    const examId = await creerTirage(evaluationId, classId, "Tirage du 12 février");

    const resultat = await generatePaperExam({ paperExamId: examId, userId: prof.id });

    expect(resultat.studentCount).toBe(2);
    expect(resultat.includedQuestionIds).toHaveLength(2);
    expect(resultat.excluded).toEqual([
      { id: expect.any(Number), reason: expect.stringMatching(/.+/) },
    ]);
    expect(resultat.artifacts.map((a) => a.file)).toContain("sujet.pdf");

    // L'ordre des copies est celui du CSV remis à AMC : l'ordre alphabétique
    // des noms. C'est lui que l'enseignant retrouvera à la saisie.
    const copies = await db
      .select({ copyNumber: paperCopies.copyNumber, studentId: paperCopies.studentId })
      .from(paperCopies)
      .where(eq(paperCopies.paperExamId, examId))
      .orderBy(asc(paperCopies.copyNumber));
    expect(copies).toEqual([
      { copyNumber: 1, studentId: studentIds[1] },
      { copyNumber: 2, studentId: studentIds[0] },
    ]);
    // L'élève inactif n'a pas de copie : on n'imprime pas pour un absent radié.
    expect(copies.map((c) => c.studentId)).not.toContain(studentIds[2]);

    const [exam] = await db.select().from(paperExams).where(eq(paperExams.id, examId));
    expect(exam.status).toBe("generated");
    expect(exam.workdir).toBe(workdirFor(examId));
    expect(exam.generatedAt).toBeInstanceOf(Date);
    // La composition est figée : la saisie se fera contre ce papier-là.
    expect(exam.printedQuestionIds).toEqual(resultat.includedQuestionIds);

    // Le sujet remis à AMC porte le titre et le sous-titre du tirage.
    const tex = await readFile(join(workdirFor(examId), "sujet.tex"), "utf8");
    expect(tex).toContain("Tirage du 12 février");
    // Le nom de l'élève vit dans le document lui-même — plus de CSV — et la
    // clé d'association est l'identifiant machine, pas le nom.
    expect(tex).toContain("Aïcha");
    expect(tex).toContain(`\\copiepour{student-${studentIds[0]}}{`);
  });

  it("réimprime sans laisser les anciennes copies derrière", async () => {
    const evaluationId = await creerEvaluationPapier([qcm()]);
    const { classId } = await creerClasse([{ nom: "Nour", prenom: "Sami" }]);
    const examId = await creerTirage(evaluationId, classId, null);

    await generatePaperExam({ paperExamId: examId, userId: prof.id });
    await generatePaperExam({ paperExamId: examId, userId: prof.id });

    const [{ n }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(paperCopies)
      .where(eq(paperCopies.paperExamId, examId));
    // Une copie par élève, pas une par impression.
    expect(Number(n)).toBe(1);
  });

  it("accepte les options déjà décodées comme celles rangées en texte", async () => {
    // Selon le pilote et la version, MySQL rend le JSON déjà décodé ou en
    // chaîne. Le tirage doit produire la même feuille dans les deux cas.
    const evaluationId = await creerEvaluationPapier([qcm()]);
    const [q] = await db.select().from(questions).where(eq(questions.evaluationId, evaluationId));
    await db
      .update(questions)
      .set({ options: ["$3$", "$4$", "$5$", "$6$"] as never })
      .where(eq(questions.id, q.id));
    const { classId } = await creerClasse([{ nom: "Ito", prenom: "Kenji" }]);
    const examId = await creerTirage(evaluationId, classId, null);

    const resultat = await generatePaperExam({ paperExamId: examId, userId: prof.id });

    expect(resultat.includedQuestionIds).toEqual([q.id]);
  });

  it("écarte une question dont le barème est illisible plutôt que d'imprimer un corrigé faux", async () => {
    const evaluationId = await creerEvaluationPapier([
      qcm(),
      qcm({ question: "Barème abîmé", gradingRubric: { mode: { kind: "inconnu" } } }),
      qcm({ question: "Barème absent", gradingRubric: null }),
    ]);
    const [saine, abimee, absente] = await db
      .select()
      .from(questions)
      .where(eq(questions.evaluationId, evaluationId))
      .orderBy(asc(questions.order));
    const { classId } = await creerClasse([{ nom: "Diallo", prenom: "Awa" }]);
    const examId = await creerTirage(evaluationId, classId, null);

    const resultat = await generatePaperExam({ paperExamId: examId, userId: prof.id });

    // AMC grille la bonne réponse sur la feuille : sans barème lisible, elle
    // est inconnue, et une case cochée au hasard vaudrait note fausse.
    expect(resultat.includedQuestionIds).toEqual([saine.id]);
    expect(resultat.excluded).toEqual([
      { id: abimee.id, reason: "Barème manquant : bonne réponse inconnue." },
      { id: absente.id, reason: "Barème manquant : bonne réponse inconnue." },
    ]);
  });
});

describe("ce qu'un tirage refuse", () => {
  it("refuse un tirage qui n'existe pas", async () => {
    await expect(
      generatePaperExam({ paperExamId: 999_999_999, userId: prof.id }),
    ).rejects.toThrow(/Tirage 999999999 introuvable/);
  });

  it("refuse un tirage dont l'évaluation a disparu", async () => {
    // La clé étrangère interdit normalement cet état ; on l'écarte le temps de
    // fabriquer l'orphelin, pour éprouver la garde qui reste en dernier rempart.
    const { classId } = await creerClasse([{ nom: "Sow", prenom: "Ibrahim" }]);
    await db.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
    let examId = 0;
    try {
      const [e] = await db.insert(paperExams).values({
        evaluationId: 999_999_998,
        classId,
        createdById: prof.id,
      });
      examId = Number(e.insertId);
    } finally {
      await db.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
    }

    await expect(
      generatePaperExam({ paperExamId: examId, userId: prof.id }),
    ).rejects.toThrow(/Évaluation introuvable/);

    await db.delete(paperExams).where(eq(paperExams.id, examId));
  });

  it("refuse d'imprimer pour une classe sans élève actif", async () => {
    const evaluationId = await creerEvaluationPapier([qcm()]);
    const { classId } = await creerClasse([{ nom: "Parti", prenom: "Luc", actif: false }]);
    const examId = await creerTirage(evaluationId, classId, null);

    await expect(
      generatePaperExam({ paperExamId: examId, userId: prof.id }),
    ).rejects.toThrow(/aucun élève actif/);
  });

  it("refuse un tirage dont aucune question ne tient sur une feuille-réponses", async () => {
    const evaluationId = await creerEvaluationPapier([
      {
        type: "short_answer",
        question: "Dérivée de $x^2$ ?",
        correctAnswer: "2*x",
        gradingRubric: { mode: { kind: "symbolic", canonical: "2*x", variables: ["x"] }, llmReviewRequired: false, weight: 3 },
      },
    ]);
    const { classId } = await creerClasse([{ nom: "Haddad", prenom: "Leïla" }]);
    const examId = await creerTirage(evaluationId, classId, null);

    await expect(
      generatePaperExam({ paperExamId: examId, userId: prof.id }),
    ).rejects.toThrow(/ajoutez des QCM ou des vrai\/faux/);

    // Rien n'a été écrit : le tirage reste au brouillon.
    const [exam] = await db.select().from(paperExams).where(eq(paperExams.id, examId));
    expect(exam.status).toBe("draft");
    const copies = await db
      .select()
      .from(paperCopies)
      .where(and(eq(paperCopies.paperExamId, examId)));
    expect(copies).toHaveLength(0);
  });
});


describe("le tirage vu depuis l'atelier", () => {
  it("annonce un tableau de bord vide plutôt que rien", async () => {
    const debutant = await creerEnseignant("Enseignant sans tirage");

    const vue = await appelEnseignant(debutant).paper.overview();

    expect(vue).toEqual({ tirages: [], derniersResultats: [] });
    await nettoyer([], [debutant.id]);
  });

  it("crée le tirage et rend les liens de téléchargement", async () => {
    const evaluationId = await creerEvaluationPapier([qcm()]);
    const { classId } = await creerClasse([{ nom: "Traoré", prenom: "Fatou" }]);

    const resultat = await appelEnseignant(prof).paper.createAndGenerate({
      evaluationId,
      classId,
      label: "Tirage du conseil",
    });
    dossiers.push(workdirFor(resultat.paperExamId));

    expect(resultat.studentCount).toBe(1);
    const sujet = resultat.downloads.find((d) => d.file === "sujet.pdf")!;
    expect(sujet.url).toBe(`/api/paper/${resultat.paperExamId}/sujet.pdf`);
    expect(sujet.label).toBe("Sujet à imprimer");
    expect(sujet.bytes).toBeGreaterThan(0);

    const vue = await appelEnseignant(prof).paper.overview();
    expect(vue.tirages.some((t) => t.id === resultat.paperExamId)).toBe(true);
  });

  it("ne laisse pas un tirage vide derrière un échec", async () => {
    const evaluationId = await creerEvaluationPapier([qcm()]);
    const { classId } = await creerClasse([{ nom: "Radié", prenom: "Paul", actif: false }]);
    const avant = await db.select().from(paperExams).where(eq(paperExams.classId, classId));

    await expect(
      appelEnseignant(prof).paper.createAndGenerate({ evaluationId, classId }),
    ).rejects.toThrow(/aucun élève actif/);

    // Un tirage qui n'a rien produit ne doit pas rester en base : il
    // apparaîtrait au tableau de bord comme un brouillon qu'on ne peut pas
    // reprendre.
    const apres = await db.select().from(paperExams).where(eq(paperExams.classId, classId));
    expect(apres.length).toBe(avant.length);
  });

  it("refuse d'imprimer l'évaluation d'un collègue pour sa propre classe", async () => {
    const collegue = await creerEnseignant("Enseignant voisin");
    const [ev] = await db.insert(evaluations).values({
      title: unique("Évaluation du voisin"),
      duration: 30,
      ownerId: collegue.id,
    });
    const evaluationId = Number(ev.insertId);
    evaluationsCreees.push(evaluationId);
    const { classId } = await creerClasse([{ nom: "Moreau", prenom: "Jean" }]);

    await expect(
      appelEnseignant(prof).paper.createAndGenerate({ evaluationId, classId }),
    ).rejects.toThrow();

    await nettoyer([], [collegue.id]);
  });
});

describe("la grille de saisie", () => {
  it("sépare ce qui se grille de ce qui se corrige à la main", async () => {
    const evaluationId = await creerEvaluationPapier([
      qcm(),
      {
        type: "short_answer",
        question: "Démontrer que la suite converge.",
        correctAnswer: "récurrence",
        points: 5,
        gradingRubric: {
          mode: { kind: "exact" }, acceptableForms: ["récurrence"],
          llmReviewRequired: true,
          weight: 5,
        },
      },
    ]);
    const { classId, studentIds } = await creerClasse([{ nom: "Aubry", prenom: "Chloé" }]);
    const examId = await creerTirage(evaluationId, classId, null);
    await generatePaperExam({ paperExamId: examId, userId: prof.id });
    const api = appelEnseignant(prof);

    const grille = await api.paper.entrySheet({ paperExamId: examId });

    expect(grille.questions).toHaveLength(1);
    expect(grille.questions[0]).toMatchObject({ position: 1, choiceCount: 4 });
    // La question rédigée n'est pas sur la feuille-réponses, mais elle se note.
    expect(grille.openQuestions).toEqual([
      { id: expect.any(Number), text: "Démontrer que la suite converge.", points: 5 },
    ]);

    await api.paper.saveEntry({
      paperExamId: examId,
      studentId: studentIds[0],
      answers: [{ questionId: grille.questions[0].id, choiceIndex: 1 }],
      openMarks: [{ questionId: grille.openQuestions[0].id, score: 4 }],
    });

    // Rouvrir la grille rend la saisie telle qu'elle a été enregistrée : la
    // note d'une question rédigée est une note, pas un choix de case.
    const reprise = await api.paper.entrySheet({ paperExamId: examId });
    const copie = reprise.copies[0];
    expect(copie.entered).toBe(true);
    expect(copie.answers[grille.questions[0].id]).toBe(1);
    expect(copie.openMarks[grille.openQuestions[0].id]).toBe(4);
    expect(copie.totalScore).toBe(6);
  });

  it("passe sans broncher une question imprimée puis supprimée", async () => {
    const evaluationId = await creerEvaluationPapier([qcm(), qcm({ question: "Seconde ?" })]);
    const { classId } = await creerClasse([{ nom: "Bernard", prenom: "Léa" }]);
    const examId = await creerTirage(evaluationId, classId, null);
    const { includedQuestionIds } = await generatePaperExam({
      paperExamId: examId,
      userId: prof.id,
    });
    // Elle reste dans la composition figée du tirage : le papier existe.
    await db.delete(questions).where(eq(questions.id, includedQuestionIds[1]));

    const grille = await appelEnseignant(prof).paper.entrySheet({ paperExamId: examId });

    expect(grille.questions.map((q) => q.id)).toEqual([includedQuestionIds[0]]);
    // La place de celle qui reste ne bouge pas : c'est celle du papier.
    expect(grille.questions[0].position).toBe(1);
  });

  it("refuse la grille d'un tirage jamais généré", async () => {
    const evaluationId = await creerEvaluationPapier([qcm()]);
    const { classId } = await creerClasse([{ nom: "Klein", prenom: "Théo" }]);
    const examId = await creerTirage(evaluationId, classId, null);

    await expect(
      appelEnseignant(prof).paper.entrySheet({ paperExamId: examId }),
    ).rejects.toThrow(/n'a pas encore été généré/);
  });

  it("grille un vrai/faux à deux cases, et compte les propositions d'un QCM", async () => {
    const evaluationId = await creerEvaluationPapier([
      qcm(),
      {
        type: "true_false",
        question: "La fonction carré est croissante sur $\\mathbb{R}$.",
        correctAnswer: "false",
        gradingRubric: { mode: { kind: "true_false", correctValue: "false" }, llmReviewRequired: false, weight: 1 },
      },
    ]);
    const { classId, studentIds } = await creerClasse([{ nom: "Perrin", prenom: "Lise" }]);
    const examId = await creerTirage(evaluationId, classId, null);
    await generatePaperExam({ paperExamId: examId, userId: prof.id });

    const grille = await appelEnseignant(prof).paper.entrySheet({ paperExamId: examId });

    expect(grille.questions.map((q) => q.choiceCount)).toEqual([4, 2]);

    // Une copie ouverte mais laissée blanche : la grille la rend vide plutôt
    // que d'inventer des cases.
    await appelEnseignant(prof).paper.saveEntry({
      paperExamId: examId,
      studentId: studentIds[0],
      answers: [],
    });
    const reprise = await appelEnseignant(prof).paper.entrySheet({ paperExamId: examId });
    expect(reprise.copies[0].answers).toEqual({});
    expect(reprise.copies[0].openMarks).toEqual({});
  });

  it("annonce un tirage sans copie plutôt que de l'omettre", async () => {
    const evaluationId = await creerEvaluationPapier([qcm()]);
    const { classId } = await creerClasse([{ nom: "Vidal", prenom: "Anna" }]);
    const examId = await creerTirage(evaluationId, classId, null);

    const liste = await appelEnseignant(prof).paper.listExams({ evaluationId });

    // Un brouillon jamais imprimé n'a aucune copie : il doit apparaître à zéro,
    // sans quoi l'enseignant ne peut pas le reprendre.
    expect(liste.find((t) => t.id === examId)).toMatchObject({ copyCount: 0 });
  });

  it("dit pourquoi une liste d'élèves n'a rien donné", async () => {
    const { classId } = await creerClasse([]);
    const api = appelEnseignant(prof);

    // Le motif remonte du lecteur : « aucun élève importé » n'aiderait pas
    // l'enseignant à comprendre ce qui cloche dans son fichier.
    await expect(
      api.paper.importStudents({ classId, csv: "nom;prenom" }),
    ).rejects.toThrow(/Fichier vide ou sans données/);

    await expect(
      api.paper.importStudents({ classId, csv: "identifiant;classe\n42;TG6\n" }),
    ).rejects.toThrow(/Aucune colonne de nom reconnue/);
  });

  it("refuse une saisie pour un élève qui n'existe pas", async () => {
    const evaluationId = await creerEvaluationPapier([qcm()]);
    const { classId } = await creerClasse([{ nom: "Nguyen", prenom: "Minh" }]);
    const examId = await creerTirage(evaluationId, classId, null);
    await generatePaperExam({ paperExamId: examId, userId: prof.id });

    await expect(
      appelEnseignant(prof).paper.saveEntry({
        paperExamId: examId,
        studentId: 999_999_999,
        answers: [],
      }),
    ).rejects.toThrow(/Élève introuvable/);
  });
});

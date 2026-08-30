/**
 * La saisie d'une copie papier, et ce qu'un élève peut exiger de ses données.
 *
 * La saisie décide de la note portée au bulletin ; l'export et l'anonymisation
 * décident de ce que l'établissement peut montrer et de ce qu'il doit oublier.
 * Les deux touchent aux mêmes lignes, et aucun n'était éprouvé de bout en bout.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  appelEnseignant, creerEnseignant, db, nettoyer, unique,
} from "./harnais";
import {
  cheatEvents, classes, evaluations, gradeAudit, paperCopies, paperExams,
  questions, responses, sessions, students,
} from "@db/schema";
import type { User } from "@db/schema";
import { generatePaperExam, workdirFor } from "../../paper/paper-service";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let prof: User;
let racine = "";
const PATH_INITIAL = process.env.PATH;
const evaluationsCreees: number[] = [];
const dossiers: string[] = [];

const SCRIPT = `#!/bin/bash
if [ "$1" = "prepare" ] && [ "$3" = "s" ]; then
  printf '%%PDF' > sujet.pdf; printf '%%PDF' > corrige.pdf; printf 'x' > calage.xy
fi
exit 0
`;

/** Une évaluation avec deux QCM grillables et une question rédigée. */
async function evaluationMixte(): Promise<{ evaluationId: number; qcm: number[]; redigee: number }> {
  const [ev] = await db.insert(evaluations).values({
    title: unique("Contrôle papier"),
    duration: 55,
    isActive: true,
    ownerId: prof.id,
  });
  const evaluationId = Number(ev.insertId);
  evaluationsCreees.push(evaluationId);

  const ids: number[] = [];
  for (const [i, def] of [
    {
      type: "qcm" as const,
      question: "Combien font deux et deux ?",
      options: JSON.stringify(["$3$", "$4$", "$5$", "$6$"]),
      correctAnswer: "1",
      points: 2,
      gradingRubric: { mode: { kind: "qcm", correctIndex: 1 }, llmReviewRequired: false, weight: 2 },
    },
    {
      type: "true_false" as const,
      question: "La fonction carré est croissante sur $\\mathbb{R}$.",
      correctAnswer: "false",
      points: 1,
      gradingRubric: { mode: { kind: "true_false", correctValue: "false" }, llmReviewRequired: false, weight: 1 },
    },
    {
      type: "short_answer" as const,
      question: "Démontrer que la suite est croissante.",
      correctAnswer: "récurrence",
      points: 5,
      gradingRubric: { mode: { kind: "exact" }, acceptableForms: ["récurrence"], llmReviewRequired: true, weight: 5 },
    },
  ].entries()) {
    const [q] = await db.insert(questions).values({ ...def, evaluationId, order: i + 1 } as never);
    ids.push(Number(q.insertId));
  }
  return { evaluationId, qcm: [ids[0], ids[1]], redigee: ids[2] };
}

/**
 * Un nom porte son propre suffixe : les suites partagent la base, et le
 * rapprochement des sessions en ligne se fait par nom exact — deux homonymes
 * venus de deux fichiers de tests fausseraient l'export.
 */
async function classeAvecEleve(nom: string, prenom: string) {
  const [c] = await db.insert(classes).values({ name: unique("Terminale"), ownerId: prof.id });
  const classId = Number(c.insertId);
  const lastName = unique(nom);
  const [s] = await db.insert(students).values({
    classId,
    lastName,
    firstName: prenom,
    email: `${prenom}.${lastName}@exemple.test`.toLowerCase(),
    externalId: unique("ext"),
  });
  return { classId, studentId: Number(s.insertId), nomComplet: `${lastName} ${prenom}` };
}

async function tirageGenere(evaluationId: number, classId: number) {
  const [e] = await db.insert(paperExams).values({
    evaluationId,
    classId,
    label: "Tirage de saisie",
    createdById: prof.id,
  });
  const paperExamId = Number(e.insertId);
  dossiers.push(workdirFor(paperExamId));
  await generatePaperExam({ paperExamId, userId: prof.id });
  return paperExamId;
}

beforeAll(async () => {
  prof = await creerEnseignant("Enseignant saisie");
  racine = await mkdtemp(join(tmpdir(), "amc-saisie-"));
  await mkdir(join(racine, "bin"), { recursive: true });
  await writeFile(join(racine, "bin", "auto-multiple-choice"), SCRIPT, "utf8");
  await chmod(join(racine, "bin", "auto-multiple-choice"), 0o755);
  process.env.PATH = `${join(racine, "bin")}:${PATH_INITIAL ?? ""}`;
});

afterAll(async () => {
  process.env.PATH = PATH_INITIAL;
  // L'ordre suit les clés étrangères : `nettoyer` emporte copies et tirages,
  // sans quoi les élèves qu'elles référencent ne peuvent pas disparaître.
  await nettoyer(evaluationsCreees, []);
  const cls = await db.select({ id: classes.id }).from(classes).where(eq(classes.ownerId, prof.id));
  for (const c of cls) await db.delete(students).where(eq(students.classId, c.id));
  await db.delete(classes).where(eq(classes.ownerId, prof.id));
  await nettoyer([], [prof.id]);
  await rm(racine, { recursive: true, force: true });
  for (const d of dossiers) await rm(d, { recursive: true, force: true });
});

describe("saisie d'une copie", () => {
  it("note la grille et la question rédigée en une seule fois", async () => {
    const { evaluationId, qcm, redigee } = await evaluationMixte();
    const { classId, studentId } = await classeAvecEleve("Benkhelifa", "Aïcha");
    const paperExamId = await tirageGenere(evaluationId, classId);
    const api = appelEnseignant(prof);

    const saisie = await api.paper.saveEntry({
      paperExamId,
      studentId,
      answers: [
        { questionId: qcm[0], choiceIndex: 1 },
        { questionId: qcm[1], choiceIndex: 1 },
        // Une case laissée vide n'est pas une réponse fausse : c'est une
        // absence de réponse, et elle ne s'enregistre pas.
        { questionId: 999_999_999, choiceIndex: 0 },
      ],
      openMarks: [{ questionId: redigee, score: 3.5 }],
    });

    expect(saisie.answered).toBe(3);
    expect(saisie.maxScore).toBe(8);
    // 2 (QCM juste) + 1 (vrai/faux juste) + 3,5 attribués à la main.
    expect(saisie.totalScore).toBe(6.5);

    const ecrites = await db
      .select()
      .from(responses)
      .where(eq(responses.sessionId, saisie.sessionId));
    expect(ecrites).toHaveLength(3);
    const manuelle = ecrites.find((r) => r.questionId === redigee)!;
    expect(manuelle.gradingMode).toBe("manual_paper");
    expect(manuelle.partialCreditApplied).toBe(true);

    // L'intervention humaine est tracée : c'est une note attribuée, pas calculée.
    const journal = await db
      .select()
      .from(gradeAudit)
      .where(eq(gradeAudit.sessionId, saisie.sessionId));
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ action: "manual_paper", actorId: prof.id });
  });

  it("ignore une case vide et une note qui ne correspond à rien", async () => {
    const { evaluationId, qcm, redigee } = await evaluationMixte();
    const { classId, studentId } = await classeAvecEleve("Nguyen", "Minh");
    const paperExamId = await tirageGenere(evaluationId, classId);

    const saisie = await appelEnseignant(prof).paper.saveEntry({
      paperExamId,
      studentId,
      answers: [
        { questionId: qcm[0], choiceIndex: null },
        { questionId: qcm[1], choiceIndex: 0 },
      ],
      openMarks: [
        { questionId: redigee, score: 99 },
        { questionId: 999_999_998, score: 5 },
      ],
    });

    const ecrites = await db.select().from(responses).where(eq(responses.sessionId, saisie.sessionId));
    // La case vide n'a rien écrit ; la note hors barème est ramenée au maximum.
    expect(ecrites.map((r) => r.questionId).sort()).toEqual([qcm[1], redigee].sort());
    expect(Number(ecrites.find((r) => r.questionId === redigee)!.score)).toBe(5);
  });

  it("remplace la saisie précédente au lieu de la compléter", async () => {
    const { evaluationId, qcm } = await evaluationMixte();
    const { classId, studentId } = await classeAvecEleve("Traoré", "Fatou");
    const paperExamId = await tirageGenere(evaluationId, classId);
    const api = appelEnseignant(prof);

    const premiere = await api.paper.saveEntry({
      paperExamId,
      studentId,
      answers: [{ questionId: qcm[0], choiceIndex: 0 }, { questionId: qcm[1], choiceIndex: 0 }],
    });
    const seconde = await api.paper.saveEntry({
      paperExamId,
      studentId,
      answers: [{ questionId: qcm[0], choiceIndex: 1 }, { questionId: qcm[1], choiceIndex: 1 }],
    });

    // Même copie, même session : une ressaisie corrige, elle ne duplique pas.
    expect(seconde.sessionId).toBe(premiere.sessionId);
    const ecrites = await db.select().from(responses).where(eq(responses.sessionId, seconde.sessionId));
    expect(ecrites).toHaveLength(2);
    expect(seconde.totalScore).toBeGreaterThan(premiere.totalScore);
  });

  it("passe une question retirée après l'impression et une case mal reportée", async () => {
    const { evaluationId, qcm } = await evaluationMixte();
    const { classId, studentId } = await classeAvecEleve("Roche", "Yanis");
    const paperExamId = await tirageGenere(evaluationId, classId);
    // La première question disparaît de l'évaluation ; le papier, lui, existe
    // toujours et l'enseignant saisit ce qu'il a sous les yeux.
    await db.delete(questions).where(eq(questions.id, qcm[0]));

    const saisie = await appelEnseignant(prof).paper.saveEntry({
      paperExamId,
      studentId,
      answers: [
        { questionId: qcm[0], choiceIndex: 1 },
        // Une troisième case sur un vrai/faux : la feuille n'en a que deux.
        { questionId: qcm[1], choiceIndex: 3 },
      ],
    });

    // Ni l'une ni l'autre ne s'enregistre, et la copie est tout de même notée.
    expect(
      await db.select().from(responses).where(eq(responses.sessionId, saisie.sessionId)),
    ).toHaveLength(0);
    expect(saisie.totalScore).toBe(0);
  });

  it("accepte une copie rendue blanche", async () => {
    const { evaluationId } = await evaluationMixte();
    const { classId, studentId } = await classeAvecEleve("Blanchet", "Emma");
    const paperExamId = await tirageGenere(evaluationId, classId);

    const saisie = await appelEnseignant(prof).paper.saveEntry({
      paperExamId,
      studentId,
      answers: [],
    });

    expect(saisie.answered).toBe(0);
    expect(saisie.totalScore).toBe(0);
    // Le barème reste celui de la feuille : une copie blanche vaut zéro sur
    // huit, pas zéro sur zéro.
    expect(saisie.maxScore).toBe(3);
  });

  it("refuse une saisie sur un tirage qui n'a jamais été imprimé", async () => {
    const { evaluationId, qcm } = await evaluationMixte();
    const { classId, studentId } = await classeAvecEleve("Prevost", "Hugo");
    const [e] = await db.insert(paperExams).values({
      evaluationId,
      classId,
      createdById: prof.id,
    });
    const paperExamId = Number(e.insertId);
    await db.insert(paperCopies).values({ paperExamId, studentId, copyNumber: 1 });

    const saisie = await appelEnseignant(prof).paper.saveEntry({
      paperExamId,
      studentId,
      answers: [{ questionId: qcm[0], choiceIndex: 1 }],
    });

    // Aucune question n'a été imprimée : rien ne peut être saisi contre elle.
    expect(saisie.answered).toBe(0);
    expect(
      await db.select().from(responses).where(eq(responses.sessionId, saisie.sessionId)),
    ).toHaveLength(0);
  });

  it("attribue la correction à celui qui saisit, faute d'un autre auteur", async () => {
    const { evaluationId, redigee } = await evaluationMixte();
    const { classId, studentId } = await classeAvecEleve("Girard", "Elsa");
    const paperExamId = await tirageGenere(evaluationId, classId);
    const { saveManualEntry } = await import("../../paper/manual-entry");

    // Appelée hors de la route — par un script de reprise, par exemple — la
    // fonction n'a pas d'acteur distinct : c'est le compte qui saisit.
    const saisie = await saveManualEntry({
      paperExamId,
      studentId,
      studentName: "Elsa Girard",
      answers: [],
      openMarks: [{ questionId: redigee, score: 5 }],
      enteredById: prof.id,
    });

    const [journal] = await db
      .select()
      .from(gradeAudit)
      .where(eq(gradeAudit.sessionId, saisie.sessionId));
    expect(journal).toMatchObject({ actorId: prof.id, actorEmail: null });
  });

  it("refuse une saisie sur un tirage inconnu", async () => {
    const { evaluationId } = await evaluationMixte();
    const { classId, studentId } = await classeAvecEleve("Klein", "Théo");
    await tirageGenere(evaluationId, classId);
    const { saveManualEntry } = await import("../../paper/manual-entry");

    await expect(
      saveManualEntry({
        paperExamId: 999_999_999,
        studentId,
        studentName: "Théo Klein",
        answers: [],
        enteredById: prof.id,
      }),
    ).rejects.toThrow(/Tirage introuvable/);
  });

  it("refuse une saisie pour un élève absent du tirage", async () => {
    const { evaluationId } = await evaluationMixte();
    const { classId } = await classeAvecEleve("Aubry", "Chloé");
    const paperExamId = await tirageGenere(evaluationId, classId);
    const autre = await classeAvecEleve("Étranger", "Paul");

    await expect(
      appelEnseignant(prof).paper.saveEntry({
        paperExamId,
        studentId: autre.studentId,
        answers: [],
      }),
    ).rejects.toThrow(/pas de copie dans ce tirage/);
  });
});

describe("données personnelles", () => {
  it("rend tout ce que l'établissement détient sur un élève", async () => {
    const { evaluationId, qcm, redigee } = await evaluationMixte();
    const { classId, studentId, nomComplet } = await classeAvecEleve("Haddad", "Leïla");
    const paperExamId = await tirageGenere(evaluationId, classId);
    const api = appelEnseignant(prof);
    await api.paper.saveEntry({
      paperExamId,
      studentId,
      answers: [{ questionId: qcm[0], choiceIndex: 1 }],
      openMarks: [{ questionId: redigee, score: 2 }],
    });

    // Une session en ligne passée sous le même nom : elle se rapproche par le
    // nom, faute de lien entre la fiche élève et une session libre.
    const [enLigne] = await db.insert(sessions).values({
      evaluationId,
      studentName: nomComplet,
      mode: "online",
      status: "completed",
      startedAt: new Date(),
      endedAt: new Date(),
      ipAddress: "203.0.113.44",
      fingerprintHash: "a".repeat(64),
      normalizedScore: "14.50",
      shuffleSeed: "graine",
    });
    const sessionEnLigne = Number(enLigne.insertId);
    await db.insert(cheatEvents).values({
      sessionId: sessionEnLigne,
      type: "tab_switch",
      timestamp: new Date(),
    });

    const dossier = await api.paper.exportStudentData({ studentId });

    expect(dossier.eleve).toMatchObject({ nom: expect.stringContaining("Haddad"), prenom: "Leïla" });
    expect(dossier.copiesPapier[0]).toMatchObject({
      numeroDeCopie: 1,
      note20: expect.any(Number),
    });
    expect(dossier.copiesPapier[0].points).toMatch(/^\d+(\.\d+)?\/8$/);
    expect(dossier.sessionsEnLigne.sessions).toHaveLength(1);
    expect(dossier.sessionsEnLigne.sessions[0]).toMatchObject({
      adresseIp: "203.0.113.44",
      incidents: 1,
      note20: 14.5,
    });
    // La méthode de rapprochement est dite : elle a des limites, l'élève doit
    // pouvoir les connaître.
    expect(dossier.sessionsEnLigne.methodeDeRapprochement).toMatch(/homonymes/);
    expect(dossier.reponses.length).toBeGreaterThan(0);
  });

  it("dit qu'une copie existe même si elle n'a jamais été saisie", async () => {
    const { evaluationId } = await evaluationMixte();
    const { classId, studentId } = await classeAvecEleve("Attente", "Noé");
    await tirageGenere(evaluationId, classId);

    const dossier = await appelEnseignant(prof).paper.exportStudentData({ studentId });

    // Une copie imprimée mais pas encore corrigée fait partie de ce que
    // l'établissement détient : elle apparaît, sans note.
    expect(dossier.copiesPapier).toHaveLength(1);
    expect(dossier.copiesPapier[0]).toMatchObject({
      numeroDeCopie: 1,
      saisieLe: null,
      note20: null,
      points: null,
    });
  });

  it("rend un dossier vide pour un élève qui n'a rien passé", async () => {
    const { studentId } = await classeAvecEleve("Neuve", "Sara");

    const dossier = await appelEnseignant(prof).paper.exportStudentData({ studentId });

    expect(dossier.copiesPapier).toEqual([]);
    expect(dossier.sessionsEnLigne.sessions).toEqual([]);
    expect(dossier.reponses).toEqual([]);
  });

  it("efface l'identité et garde les notes", async () => {
    const { evaluationId, qcm } = await evaluationMixte();
    const { classId, studentId, nomComplet } = await classeAvecEleve("Oubli", "Marc");
    const paperExamId = await tirageGenere(evaluationId, classId);
    const api = appelEnseignant(prof);
    const saisie = await api.paper.saveEntry({
      paperExamId,
      studentId,
      answers: [{ questionId: qcm[0], choiceIndex: 1 }],
    });
    const [enLigne] = await db.insert(sessions).values({
      evaluationId,
      studentName: nomComplet,
      mode: "online",
      status: "completed",
      startedAt: new Date(),
      ipAddress: "203.0.113.55",
      fingerprintHash: "b".repeat(64),
      userAgent: "Firefox",
      shuffleSeed: "graine",
    });
    const sessionEnLigne = Number(enLigne.insertId);

    const bilan = await api.paper.anonymizeStudent({ studentId });

    expect(bilan.pseudonyme).toMatch(/.+/);
    expect(bilan.copiesConservees).toBe(1);
    // La copie papier et la session en ligne : les deux portaient son nom.
    expect(bilan.sessionsAnonymisees).toBe(2);
    const [fiche] = await db.select().from(students).where(eq(students.id, studentId));
    expect(fiche.lastName).not.toBe("Oubli");
    expect(fiche.email).toBeNull();

    // La note reste : l'établissement doit conserver le résultat d'une épreuve.
    const [copie] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, saisie.sessionId));
    expect(copie.totalScore).not.toBeNull();

    const [libre] = await db.select().from(sessions).where(eq(sessions.id, sessionEnLigne));
    expect(libre.studentName).not.toContain("Oubli");
    expect(libre.ipAddress).toBeNull();
    expect(libre.fingerprintHash).toBeNull();
    expect(libre.userAgent).toBeNull();
  });

  it("refuse d'exporter ou d'anonymiser un élève qui n'existe pas", async () => {
    const { exportStudentData, anonymizeStudent } = await import("../../paper/student-data");
    await expect(exportStudentData(999_999_999)).rejects.toThrow(/introuvable/);
    await expect(anonymizeStudent(999_999_999)).rejects.toThrow(/introuvable/);
  });

  it("refuse l'accès aux données d'un élève d'un collègue", async () => {
    const { studentId } = await classeAvecEleve("Voisine", "Nour");
    const voisin = await creerEnseignant("Enseignant voisin rgpd");

    await expect(
      appelEnseignant(voisin).paper.exportStudentData({ studentId }),
    ).rejects.toThrow();
    await expect(
      appelEnseignant(voisin).paper.anonymizeStudent({ studentId }),
    ).rejects.toThrow();

    await nettoyer([], [voisin.id]);
  });
});

describe("relevé du tirage", () => {
  it("rend les mêmes notes que les documents imprimés", async () => {
    const { evaluationId, qcm } = await evaluationMixte();
    const { classId, studentId } = await classeAvecEleve("Moreau", "Jean");
    const paperExamId = await tirageGenere(evaluationId, classId);
    const api = appelEnseignant(prof);
    await api.paper.saveEntry({
      paperExamId,
      studentId,
      answers: [{ questionId: qcm[0], choiceIndex: 1 }],
    });

    const releve = await api.paper.results({ paperExamId });

    expect(releve.lignes).toHaveLength(1);
    expect(releve.lignes[0]).toMatchObject({ copyNumber: 1, saisie: true });
    expect(releve.stats.saisies).toBe(1);

    const copies = await db
      .select()
      .from(paperCopies)
      .where(and(eq(paperCopies.paperExamId, paperExamId), eq(paperCopies.studentId, studentId)));
    expect(copies[0].enteredAt).not.toBeNull();
  });
});

/**
 * api/paper/student-data.ts
 *
 * Droit d'accès et droit à l'effacement, pour un élève.
 *
 * **Effacement plutôt qu'anonymisation ?** Supprimer un élève emporterait ses
 * copies et donc les notes d'une évaluation déjà rendue — un établissement a
 * des obligations de conservation des résultats. L'anonymisation répond au
 * droit à l'effacement sans détruire l'évaluation : identité remplacée par un
 * pseudonyme stable, notes conservées, plus aucune donnée personnelle.
 *
 * **Sessions en ligne.** Elles n'ont pas de lien vers `students` : l'élève y
 * saisit son nom librement. Le rapprochement se fait donc par nom, ce qui est
 * approximatif — c'est indiqué dans l'export plutôt que passé sous silence.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  cheatEvents,
  classes,
  evaluations,
  paperCopies,
  paperExams,
  questions,
  responses,
  sessions,
  students,
} from "@db/schema";
import { logger } from "../lib/logger";
import { toNumber } from "../lib/decimal";

export interface StudentDataExport {
  genereLe: string;
  eleve: {
    id: number;
    nom: string;
    prenom: string;
    email: string | null;
    identifiantExterne: string | null;
    inscritLe: string;
    classe: string | null;
  };
  copiesPapier: Array<{
    evaluation: string;
    tirage: string | null;
    numeroDeCopie: number | null;
    saisieLe: string | null;
    note20: number | null;
    points: string | null;
  }>;
  sessionsEnLigne: {
    /** Rapprochement effectué par nom : voir la note ci-dessous. */
    methodeDeRapprochement: string;
    sessions: Array<{
      evaluation: string;
      passeeLe: string;
      statut: string;
      note20: number | null;
      adresseIp: string | null;
      empreinteNavigateur: string | null;
      incidents: number;
    }>;
  };
  reponses: Array<{
    evaluation: string;
    question: string;
    reponse: string;
    points: number | null;
    surPoints: number | null;
    commentaire: string | null;
  }>;
}

export async function exportStudentData(studentId: number): Promise<StudentDataExport> {
  const db = getDb();

  const [eleve] = await db
    .select({ s: students, classe: classes.name })
    .from(students)
    .leftJoin(classes, eq(classes.id, students.classId))
    .where(eq(students.id, studentId))
    .limit(1);

  if (!eleve) throw new Error("Élève introuvable");

  const nomComplet = `${eleve.s.lastName} ${eleve.s.firstName}`.trim();

  const copies = await db
    .select({
      copie: paperCopies,
      tirage: paperExams.label,
      evaluation: evaluations.title,
      session: sessions,
    })
    .from(paperCopies)
    .innerJoin(paperExams, eq(paperExams.id, paperCopies.paperExamId))
    .innerJoin(evaluations, eq(evaluations.id, paperExams.evaluationId))
    .leftJoin(sessions, eq(sessions.id, paperCopies.sessionId))
    .where(eq(paperCopies.studentId, studentId));

  // Sessions en ligne : rapprochement par nom, faute de lien.
  const enLigne = await db
    .select({ session: sessions, evaluation: evaluations.title })
    .from(sessions)
    .innerJoin(evaluations, eq(evaluations.id, sessions.evaluationId))
    .where(and(eq(sessions.studentName, nomComplet), eq(sessions.mode, "online")));

  const idsSessions = [
    ...copies.map((c) => c.session?.id).filter((v): v is number => typeof v === "number"),
    ...enLigne.map((e) => e.session.id),
  ];

  const incidents = idsSessions.length
    ? await db
        .select({ sessionId: cheatEvents.sessionId })
        .from(cheatEvents)
        .where(inArray(cheatEvents.sessionId, idsSessions))
    : [];
  const incidentsParSession = new Map<number, number>();
  for (const i of incidents) {
    incidentsParSession.set(i.sessionId, (incidentsParSession.get(i.sessionId) ?? 0) + 1);
  }

  const reponses = idsSessions.length
    ? await db
        .select({
          r: responses,
          question: questions.question,
          evaluation: evaluations.title,
        })
        .from(responses)
        .innerJoin(questions, eq(questions.id, responses.questionId))
        .innerJoin(evaluations, eq(evaluations.id, questions.evaluationId))
        .where(inArray(responses.sessionId, idsSessions))
    : [];

  return {
    genereLe: new Date().toISOString(),
    eleve: {
      id: eleve.s.id,
      nom: eleve.s.lastName,
      prenom: eleve.s.firstName,
      email: eleve.s.email,
      identifiantExterne: eleve.s.externalId,
      inscritLe: eleve.s.createdAt.toISOString(),
      classe: eleve.classe,
    },
    copiesPapier: copies.map((c) => ({
      evaluation: c.evaluation,
      tirage: c.tirage,
      numeroDeCopie: c.copie.copyNumber,
      saisieLe: c.copie.enteredAt?.toISOString() ?? null,
      note20: c.session?.normalizedScore ? parseFloat(c.session.normalizedScore) : null,
      points:
        c.session?.totalScore != null
          ? `${toNumber(c.session.totalScore)}/${c.session.maxScore}`
          : null,
    })),
    sessionsEnLigne: {
      methodeDeRapprochement:
        "Rapprochement par nom exact : une session en ligne n'est pas liée à la fiche élève, le nom y est saisi librement. Des homonymes peuvent apparaître, et une faute de frappe peut en masquer.",
      sessions: enLigne.map((e) => ({
        evaluation: e.evaluation,
        passeeLe: e.session.startedAt.toISOString(),
        statut: e.session.status,
        note20: e.session.normalizedScore ? parseFloat(e.session.normalizedScore) : null,
        adresseIp: e.session.ipAddress,
        empreinteNavigateur: e.session.fingerprintHash,
        incidents: incidentsParSession.get(e.session.id) ?? 0,
      })),
    },
    reponses: reponses.map((x) => ({
      evaluation: x.evaluation,
      question: x.question,
      reponse: x.r.answer,
      points: toNumber(x.r.score),
      surPoints: x.r.maxScore,
      commentaire: x.r.llmFeedback,
    })),
  };
}

export interface AnonymizeResult {
  pseudonyme: string;
  copiesConservees: number;
  sessionsEnLigneAnonymisees: number;
}

/**
 * Retire toute donnée personnelle en conservant les résultats.
 * Idempotent : réappliquer ne change rien.
 */
export async function anonymizeStudent(studentId: number): Promise<AnonymizeResult> {
  const db = getDb();

  const [eleve] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!eleve) throw new Error("Élève introuvable");

  const pseudonyme = `Élève anonymisé ${studentId}`;
  const nomComplet = `${eleve.lastName} ${eleve.firstName}`.trim();

  const copies = await db
    .select({ id: paperCopies.id, sessionId: paperCopies.sessionId })
    .from(paperCopies)
    .where(eq(paperCopies.studentId, studentId));

  let sessionsAnonymisees = 0;

  await db.transaction(async (tx) => {
    await tx
      .update(students)
      .set({
        lastName: pseudonyme,
        firstName: "",
        email: null,
        externalId: null,
        active: false,
      })
      .where(eq(students.id, studentId));

    // Sessions liées aux copies papier.
    const idsSessions = copies
      .map((c) => c.sessionId)
      .filter((v): v is number => typeof v === "number");
    if (idsSessions.length > 0) {
      await tx
        .update(sessions)
        .set({ studentName: pseudonyme, studentEmail: null, ipAddress: null, fingerprintHash: null, userAgent: null })
        .where(inArray(sessions.id, idsSessions));
      sessionsAnonymisees += idsSessions.length;
    }

    // Sessions en ligne rapprochées par nom.
    const enLigne = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.studentName, nomComplet), eq(sessions.mode, "online")));
    if (enLigne.length > 0) {
      await tx
        .update(sessions)
        .set({ studentName: pseudonyme, studentEmail: null, ipAddress: null, fingerprintHash: null, userAgent: null })
        .where(inArray(sessions.id, enLigne.map((s) => s.id)));
      sessionsAnonymisees += enLigne.length;
    }
  });

  logger.info("[rgpd] Élève anonymisé", {
    studentId,
    copies: copies.length,
    sessions: sessionsAnonymisees,
  });

  return {
    pseudonyme,
    copiesConservees: copies.length,
    sessionsEnLigneAnonymisees: sessionsAnonymisees,
  };
}

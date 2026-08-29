/**
 * api/paper/manual-entry.ts
 *
 * Saisie manuelle d'une copie papier, puis notation.
 *
 * Principe : une copie saisie devient une `session` en `mode = 'paper'`, et
 * passe par `gradeSessionResponses` — le moteur qui note les copies en ligne.
 * Un élève obtient donc la même note pour la même copie, quel que soit le
 * support. C'était l'objet de `sessions.mode` introduit au lot A.
 *
 * Conversion des lettres. Sur la feuille-réponses, l'enseignant lit des
 * lettres : A, B, C, D. Elles correspondent aux propositions dans l'ordre
 * imprimé, qui est l'ordre d'origine puisque le tirage ne mélange rien.
 * - QCM : la lettre devient directement l'index (« C » → 2).
 * - Vrai/Faux : le sujet imprime toujours Vrai puis Faux, donc A → « true »,
 *   B → « false ». Sans cette conversion, `gradeResponse` ne reconnaîtrait pas
 *   « 0 » comme une valeur booléenne et la question serait comptée fausse.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { paperCopies, paperExams, questions, responses, sessions } from "@db/schema";
import { gradeSessionResponses } from "../grading/grade-session";
import { logger } from "../lib/logger";
import { toDecimal } from "../lib/decimal";

export interface EntryAnswer {
  questionId: number;
  /** Index de la lettre cochée, ou `null` si la case est restée vide. */
  choiceIndex: number | null;
}

/**
 * Points attribués à une question rédigée, corrigée à la main sur la copie.
 * Ces questions ne figurent pas sur la feuille-réponses : elles n'ont pas de
 * case à cocher, et sans ce complément leurs points seraient définitivement
 * perdus pour l'élève.
 */
export interface OpenMark {
  questionId: number;
  score: number;
}

export interface SaveEntryResult {
  sessionId: number;
  totalScore: number;
  maxScore: number;
  normalizedScore: number;
  answered: number;
}

/**
 * Traduit une lettre de la feuille-réponses en réponse stockable.
 * Retourne `null` quand la question n'est pas grillable.
 */
export function choiceToAnswer(
  questionType: "qcm" | "true_false" | "short_answer",
  choiceIndex: number,
): string | null {
  if (questionType === "qcm") return String(choiceIndex);
  if (questionType === "true_false") return choiceIndex === 0 ? "true" : "false";
  return null;
}

/**
 * Conversion inverse : retrouve la lettre cochée à partir de la réponse
 * enregistrée, pour réafficher une copie déjà saisie.
 */
export function answerToChoice(
  questionType: string,
  answer: string,
): number | null {
  if (questionType === "qcm") {
    const n = Number.parseInt(answer, 10);
    return Number.isNaN(n) ? null : n;
  }
  if (questionType === "true_false") {
    return answer === "true" ? 0 : answer === "false" ? 1 : null;
  }
  return null;
}

export async function saveManualEntry(args: {
  paperExamId: number;
  studentId: number;
  studentName: string;
  answers: EntryAnswer[];
  /** Notes des questions rédigées, saisies par l'enseignant. */
  openMarks?: OpenMark[];
  enteredById: number;
}): Promise<SaveEntryResult> {
  const db = getDb();

  const [exam] = await db
    .select()
    .from(paperExams)
    .where(eq(paperExams.id, args.paperExamId))
    .limit(1);
  if (!exam) throw new Error("Tirage introuvable");

  const [copy] = await db
    .select()
    .from(paperCopies)
    .where(
      and(
        eq(paperCopies.paperExamId, args.paperExamId),
        eq(paperCopies.studentId, args.studentId),
      ),
    )
    .limit(1);
  if (!copy) throw new Error("Cet élève n'a pas de copie dans ce tirage.");

  // Seules les questions réellement imprimées sont acceptées : saisir contre
  // une question ajoutée après le tirage n'aurait aucun sens.
  const imprimees = new Set(exam.printedQuestionIds ?? []);
  const retenues = args.answers.filter((a) => imprimees.has(a.questionId));

  // Les questions rédigées appartiennent à l'évaluation mais pas à la grille :
  // elles sont notées à la main, et leur barème compte dans le total.
  const marques = (args.openMarks ?? []).filter((m) => !imprimees.has(m.questionId));

  const idsConcernes = [
    ...retenues.map((a) => a.questionId),
    ...marques.map((m) => m.questionId),
  ];

  const qs = idsConcernes.length
    ? await db
        .select({ id: questions.id, type: questions.type, points: questions.points })
        .from(questions)
        .where(inArray(questions.id, idsConcernes))
    : [];
  const typeParId = new Map(qs.map((q) => [q.id, q.type]));
  const bareme = new Map(qs.map((q) => [q.id, q.points]));

  let sessionId = copy.sessionId ?? null;

  await db.transaction(async (tx) => {
    if (sessionId) {
      // Ressaisie : on repart d'une copie vierge plutôt que de fusionner.
      await tx.delete(responses).where(eq(responses.sessionId, sessionId));
    } else {
      const [row] = await tx.insert(sessions).values({
        evaluationId: exam.evaluationId,
        studentName: args.studentName,
        mode: "paper",
        status: "completed",
        startedAt: new Date(),
        endedAt: new Date(),
        // Aucune graine : en mode papier, la correspondance est directe.
        shuffleSeed: null,
      });
      sessionId = Number(row.insertId);
      await tx
        .update(paperCopies)
        .set({ sessionId, enteredAt: new Date(), enteredById: args.enteredById })
        .where(eq(paperCopies.id, copy.id));
    }

    for (const a of retenues) {
      if (a.choiceIndex === null) continue; // case laissée vide : pas de réponse
      const type = typeParId.get(a.questionId);
      if (!type) continue;
      const answer = choiceToAnswer(type, a.choiceIndex);
      if (answer === null) continue;

      await tx.insert(responses).values({
        sessionId: sessionId!,
        questionId: a.questionId,
        answer,
        maxScore: 0,
        partialCreditApplied: false,
      });
    }

    // Questions rédigées : la note vient de l'enseignant, le moteur ne la
    // recalculera pas (voir `estNoteManuelle`).
    for (const m of marques) {
      const max = bareme.get(m.questionId);
      if (max === undefined) continue;
      const points = Math.max(0, Math.min(max, Math.round(m.score * 4) / 4));
      await tx.insert(responses).values({
        sessionId: sessionId!,
        questionId: m.questionId,
        answer: "(corrigée sur copie)",
        score: toDecimal(points),
        maxScore: max,
        isCorrect: points >= max,
        gradingMode: "manual_paper",
        gradedAt: new Date(),
        partialCreditApplied: points > 0 && points < max,
      });
    }

    await tx
      .update(paperCopies)
      .set({ enteredAt: new Date(), enteredById: args.enteredById })
      .where(eq(paperCopies.id, copy.id));
  });

  // Notation par le moteur partagé, sans LLM : une copie papier ne contient
  // que des réponses cochées, il n'y a rien à faire relire.
  // Le barème se limite aux questions imprimées : les réponses rédigées ne
  // figurent pas sur la feuille et seront corrigées à part.
  const grading = await gradeSessionResponses(sessionId!, {
    skipLLM: true,
    // Périmètre : la feuille-réponses, plus les questions rédigées que
    // l'enseignant a effectivement notées.
    questionIds: [...(exam.printedQuestionIds ?? []), ...marques.map((m) => m.questionId)],
  });

  await db
    .update(sessions)
    .set({ timeSpent: null })
    .where(eq(sessions.id, sessionId!));

  logger.info("[paper] Copie saisie", {
    paperExamId: args.paperExamId,
    studentId: args.studentId,
    sessionId,
    note: grading.normalizedScore,
  });

  return {
    sessionId: sessionId!,
    totalScore: grading.totalScore,
    maxScore: grading.maxScore,
    normalizedScore: grading.normalizedScore,
    answered: retenues.filter((a) => a.choiceIndex !== null).length + marques.length,
  };
}

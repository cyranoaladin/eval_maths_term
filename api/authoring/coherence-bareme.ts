/**
 * api/authoring/coherence-bareme.ts
 *
 * « La réponse que vous montrez, votre barème l'accepte-t-il ? »
 *
 * Une question porte deux descriptions de sa bonne réponse : la colonne
 * `questions.correctAnswer`, lisible par un humain et affichée à l'enseignant
 * dans l'aperçu, l'éditeur et l'écran de correction ; et `gradingRubric.mode`,
 * seule consultée par le moteur. Les deux ne sont pas redondantes — l'une est
 * une écriture, l'autre une règle de comparaison — mais elles doivent
 * s'accorder.
 *
 * Le contrôle structurel de `contracts/question-coherence.ts` liait déjà les
 * deux pour les QCM et les vrai/faux, où la correspondance est littérale. Pour
 * une réponse courte, il exigeait seulement que la fiche ne soit pas vide :
 * l'enseignant pouvait afficher « x = 2 » à côté d'un barème qui n'accepte que
 * « 2 », et découvrir après l'épreuve que toute la classe avait faux.
 *
 * Le contrôle est ici, et il ne raisonne pas sur les formes : il soumet la
 * réponse annoncée au moteur de correction, exactement comme une copie d'élève.
 * S'il n'obtient pas tous les points, c'est que l'un des deux est faux.
 */
import { TRPCError } from "@trpc/server";
import { gradeResponse } from "../grading/grade-response";
import type { GradingRubric } from "@contracts/grading-rubric";
import type { QuestionType } from "@contracts/types";

export interface QuestionAVerifier {
  type: QuestionType;
  question: string;
  correctAnswer: string;
  points: number;
  gradingRubric: GradingRubric;
}

export interface VerdictBareme {
  reconnue: boolean;
  /** Points obtenus par la réponse annoncée, sur `points`. */
  score: number;
  raison: string;
}

/**
 * Corrige la réponse annoncée avec le barème de la question.
 *
 * Le modèle de langage n'est jamais sollicité : une question dont la
 * correction dépend d'un jugement rédactionnel ne peut pas être validée
 * automatiquement, et un appel réseau n'a rien à faire dans une écriture.
 */
export async function verifierQueLeBaremeReconnaitLaReponse(
  q: QuestionAVerifier,
): Promise<VerdictBareme> {
  const resultat = await gradeResponse({
    questionType: q.type,
    studentAnswer: q.correctAnswer,
    rubric: q.gradingRubric,
    questionText: q.question,
    maxPoints: q.points,
    resolvedQcmIndex:
      q.gradingRubric.mode.kind === "qcm"
        ? Number.parseInt(q.correctAnswer, 10)
        : undefined,
    skipLLM: true,
  });

  // Une question qui exige une relecture par le modèle ne peut pas être
  // tranchée ici : on ne la déclare pas incohérente pour autant.
  if (resultat.needsLLM) {
    return {
      reconnue: true,
      score: resultat.score,
      raison: "correction assistée : la cohérence ne peut pas être établie sans le modèle",
    };
  }

  return {
    reconnue: resultat.score >= q.points,
    score: resultat.score,
    raison: resultat.feedback,
  };
}

/** Refuse l'écriture d'une question dont le barème ne reconnaît pas sa réponse. */
export async function assertBaremeCoherent(q: QuestionAVerifier): Promise<void> {
  const verdict = await verifierQueLeBaremeReconnaitLaReponse(q);
  if (verdict.reconnue) return;

  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      `Le barème ne reconnaît pas la réponse annoncée : « ${q.correctAnswer} » ` +
      `obtient ${verdict.score} point(s) sur ${q.points}. ` +
      `Corrigez l'un des deux — c'est le barème qui notera les copies. ` +
      `(${verdict.raison})`,
  });
}

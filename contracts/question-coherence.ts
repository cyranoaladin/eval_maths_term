/**
 * contracts/question-coherence.ts
 *
 * Cohérence d'une question avant écriture en base.
 *
 * Pourquoi ce garde-fou. Une question porte deux descriptions de sa bonne
 * réponse : la colonne `questions.correctAnswer`, héritée de la Phase 0, et
 * `gradingRubric.mode`, seule consultée par le moteur de correction depuis la
 * Phase 2. Une question dont les deux divergent est acceptée par la base, se
 * relit normalement dans l'éditeur, et note faux en silence.
 *
 * `rubric.weight` n'est lu par aucun correcteur : le barème est `questions.points`.
 * On impose l'égalité pour que le champ ne devienne pas trompeur.
 *
 * Fonction pure, sans accès base : testable et réutilisable côté client pour
 * afficher les erreurs avant l'envoi.
 */
import { GradingRubricSchema, type GradingRubric } from "./grading-rubric";
import type { QuestionType } from "./types";

export interface QuestionDraft {
  type: QuestionType;
  question: string;
  options?: string[] | null;
  correctAnswer: string;
  points: number;
  justificationRequired?: boolean;
  gradingRubric: GradingRubric;
}

export type CoherenceResult =
  | { ok: true }
  | { ok: false; errors: string[] };

const SHORT_ANSWER_MODES = ["exact", "symbolic", "numeric", "fraction", "set"] as const;

export function validateQuestionCoherence(draft: QuestionDraft): CoherenceResult {
  const errors: string[] = [];

  const parsed = GradingRubricSchema.safeParse(draft.gradingRubric);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [`Barème de correction invalide : ${parsed.error.issues[0]?.message ?? "structure inattendue"}`],
    };
  }
  const rubric = parsed.data;
  const mode = rubric.mode;

  if (draft.question.trim().length === 0) {
    errors.push("L'énoncé ne peut pas être vide.");
  }
  if (!Number.isInteger(draft.points) || draft.points < 1) {
    errors.push("Le barème doit être un entier d'au moins 1 point.");
  }
  if (rubric.weight !== draft.points) {
    errors.push(
      `Le poids du barème (${rubric.weight}) doit être égal au nombre de points (${draft.points}).`,
    );
  }

  switch (draft.type) {
    case "qcm": {
      if (mode.kind !== "qcm") {
        errors.push(`Une question QCM exige un barème de type « qcm », reçu « ${mode.kind} ».`);
        break;
      }
      const options = draft.options ?? [];
      if (options.length < 2) {
        errors.push("Un QCM demande au moins deux propositions.");
      }
      if (options.some((o) => o.trim().length === 0)) {
        errors.push("Aucune proposition ne peut être vide.");
      }
      if (new Set(options.map((o) => o.trim())).size !== options.length) {
        errors.push("Deux propositions sont identiques.");
      }
      if (mode.correctIndex >= options.length) {
        errors.push(
          `La bonne réponse désigne la proposition ${mode.correctIndex + 1}, or il n'y en a que ${options.length}.`,
        );
      }
      if (draft.correctAnswer !== String(mode.correctIndex)) {
        errors.push(
          `Incohérence : la fiche indique « ${draft.correctAnswer} » alors que le barème corrige sur l'index ${mode.correctIndex}. C'est le barème qui note.`,
        );
      }
      break;
    }

    case "true_false": {
      if (mode.kind !== "true_false") {
        errors.push(`Une question vrai/faux exige un barème de type « true_false », reçu « ${mode.kind} ».`);
        break;
      }
      if (draft.options && draft.options.length > 0) {
        errors.push("Une question vrai/faux ne porte pas de propositions.");
      }
      if (draft.correctAnswer !== mode.correctValue) {
        errors.push(
          `Incohérence : la fiche indique « ${draft.correctAnswer} » alors que le barème corrige sur « ${mode.correctValue} ». C'est le barème qui note.`,
        );
      }
      break;
    }

    case "short_answer": {
      if (!SHORT_ANSWER_MODES.includes(mode.kind as (typeof SHORT_ANSWER_MODES)[number])) {
        errors.push(
          `Une réponse courte exige un barème parmi ${SHORT_ANSWER_MODES.join(", ")}, reçu « ${mode.kind} ».`,
        );
        break;
      }
      if (draft.options && draft.options.length > 0) {
        errors.push("Une réponse courte ne porte pas de propositions.");
      }
      if (draft.correctAnswer.trim().length === 0) {
        errors.push("La réponse attendue ne peut pas être vide.");
      }
      break;
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

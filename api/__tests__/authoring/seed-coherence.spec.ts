/**
 * Le jeu de questions de référence doit satisfaire les règles que l'éditeur
 * impose désormais. Si le seed lui-même ne passe pas, soit les règles sont
 * trop strictes, soit les données de référence notent déjà de travers.
 */
import { describe, expect, it } from "vitest";
import { evaluationQuestions } from "@contracts/evaluation-data";
import { validateQuestionCoherence } from "@contracts/question-coherence";

describe("cohérence du jeu de questions de référence", () => {
  it("les 20 questions du seed sont cohérentes", () => {
    const problemes: string[] = [];

    for (const q of evaluationQuestions) {
      if (!q.gradingRubric) {
        problemes.push(`Question ${q.order} : aucune rubric`);
        continue;
      }
      const verdict = validateQuestionCoherence({
        type: q.type,
        question: q.question,
        options: q.options ?? null,
        correctAnswer: q.correctAnswer,
        points: q.points,
        justificationRequired: q.justificationRequired,
        gradingRubric: q.gradingRubric,
      });
      if (!verdict.ok) {
        problemes.push(`Question ${q.order} : ${verdict.errors.join(" ")}`);
      }
    }

    expect(problemes).toEqual([]);
  });

  it("le barème total est bien de 30 points", () => {
    expect(evaluationQuestions.reduce((s, q) => s + q.points, 0)).toBe(30);
  });
});

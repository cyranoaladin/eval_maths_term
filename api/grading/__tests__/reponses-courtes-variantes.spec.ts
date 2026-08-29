/**
 * Critère 6 : chacune des cinq questions à réponse courte doit accepter au
 * moins cinq écritures équivalentes de la bonne réponse.
 *
 * Les barèmes ci-dessous sont ceux réellement enregistrés pour l'évaluation
 * « Mathématiques — Terminale Spécialité » (questions 11 à 15). Les variantes
 * ne sont pas décoratives : chacune correspond à une façon dont un élève écrit
 * effectivement sa réponse — au clavier, dans le champ mathématique, avec la
 * virgule décimale française, ou en réordonnant les termes.
 *
 * Les variantes marquées « MathLive » sont les chaînes LaTeX que le champ
 * produit réellement pour la frappe indiquée ; elles ont été relevées dans un
 * navigateur, pas devinées.
 */
import { describe, it, expect } from "vitest";
import { gradeResponse } from "../grade-response";
import type { GradingRubric } from "@contracts/grading-rubric";

interface CasRC {
  titre: string;
  rubric: GradingRubric;
  points: number;
  variantes: string[];
  fausses: string[];
}

const CAS: CasRC[] = [
  {
    titre: "Q11 — limite valant 2 (numérique exact)",
    rubric: {
      mode: { kind: "numeric", value: 2, tolerance: 1e-12, relative: false },
      llmReviewRequired: false,
      weight: 2,
    },
    points: 2,
    variantes: [
      "2",
      "2.0",
      "2,0",              // virgule décimale française
      " 2 ",              // espaces parasites
      "+2",               // signe explicite
      "\\frac42",         // MathLive, frappe « 4/2 »
      "4/2",
    ],
    fausses: ["3", "-2", "2.5"],
  },
  {
    titre: "Q12 — dérivée 2·e^{2x} − 3 (symbolique)",
    rubric: {
      mode: { kind: "symbolic", canonical: "2*exp(2*x) - 3", variables: ["x"] },
      llmReviewRequired: false,
      weight: 2,
    },
    points: 2,
    variantes: [
      "2*exp(2*x)-3",
      "2exp(2x)-3",
      "-3+2*exp(2*x)",          // termes réordonnés
      "2e^(2x)-3",
      "2e^{2x}-3",
      "2\\cdot e^{2x}-3",       // MathLive, frappe « 2*e^2x »
      "2\\mathrm{e}^{2x}-3",    // notation française de l'exponentielle
    ],
    fausses: ["2*exp(2*x)+3", "exp(2*x)-3", "2*exp(x)-3"],
  },
  {
    titre: "Q13 — intégrale valant ln 2 (symbolique)",
    rubric: {
      mode: { kind: "symbolic", canonical: "log(2)", variables: [] },
      llmReviewRequired: false,
      weight: 2,
    },
    points: 2,
    variantes: [
      "log(2)",
      "ln(2)",
      "ln2",
      "\\ln(2)",
      "\\ln\\left(2\\right)",   // MathLive, frappe « ln(2) »
      "\\ln 2",
      "LN(2)",                  // casse
    ],
    fausses: ["log10(2)", "2", "ln(3)"],
  },
  {
    titre: "Q14 — solution 2 − e^{−2x} (symbolique)",
    rubric: {
      mode: { kind: "symbolic", canonical: "2 - exp(-2*x)", variables: ["x"] },
      llmReviewRequired: false,
      weight: 2,
    },
    points: 2,
    variantes: [
      "2-exp(-2*x)",
      "2-e^(-2x)",
      "-e^(-2x)+2",
      "2-e^{-2x}",
      "-\\mathrm{e}^{-2x}+2",
      "2-\\exp\\left(-2x\\right)",  // MathLive
    ],
    fausses: ["2+exp(-2*x)", "2-exp(2*x)", "1-exp(-2*x)"],
  },
  {
    titre: "Q15 — probabilité 17/32 (fraction irréductible)",
    rubric: {
      mode: { kind: "fraction", numerator: 17, denominator: 32, reduced: true },
      llmReviewRequired: false,
      weight: 2,
    },
    points: 2,
    variantes: [
      "17/32",
      " 17 / 32 ",
      "\\frac{17}{32}",
      "\\dfrac{17}{32}",
      "\\frac{17}{32}",
      "17\\div32",                  // MathLive, frappe « 17÷32 »
    ],
    fausses: ["17/33", "16/32", "1/2"],
  },
];

describe("réponses courtes : variantes équivalentes acceptées", () => {
  for (const cas of CAS) {
    describe(cas.titre, () => {
      it("propose au moins cinq écritures équivalentes", () => {
        expect(cas.variantes.length).toBeGreaterThanOrEqual(5);
      });

      it.each(cas.variantes)("accepte « %s »", async (variante) => {
        const r = await gradeResponse({
          questionType: "short_answer",
          studentAnswer: variante,
          rubric: cas.rubric,
          questionText: cas.titre,
          maxPoints: cas.points,
          skipLLM: true,
        });
        expect(r.isCorrect, `${r.gradingMode} — ${r.feedback}`).toBe(true);
        expect(r.score).toBe(cas.points);
      });

      it.each(cas.fausses)("refuse « %s »", async (fausse) => {
        const r = await gradeResponse({
          questionType: "short_answer",
          studentAnswer: fausse,
          rubric: cas.rubric,
          questionText: cas.titre,
          maxPoints: cas.points,
          skipLLM: true,
        });
        expect(r.isCorrect, `${r.gradingMode} — ${r.feedback}`).toBe(false);
      });
    });
  }
});

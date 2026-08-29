/**
 * Le mode de saisie est la seule chose que le barème laisse transparaître vers
 * l'élève. Ces tests fixent exactement ce qu'il dit — et ce qu'il ne dit pas.
 */
import { describe, it, expect } from "vitest";
import { modeSaisie } from "../input-mode";
import type { GradingRubric } from "@contracts/grading-rubric";

function rubric(mode: GradingRubric["mode"]): GradingRubric {
  return { mode, llmReviewRequired: false, weight: 1 };
}

describe("modeSaisie", () => {
  it("propose le clavier mathématique pour une comparaison numérique", () => {
    expect(modeSaisie(rubric({ kind: "numeric", value: 0.5, tolerance: 0.01, relative: false })))
      .toBe("math");
  });

  it("propose le clavier mathématique pour une fraction", () => {
    expect(modeSaisie(rubric({ kind: "fraction", numerator: 1, denominator: 2, reduced: true })))
      .toBe("math");
  });

  it("propose le clavier mathématique pour une expression symbolique", () => {
    expect(modeSaisie(rubric({ kind: "symbolic", canonical: "2*x", variables: ["x"] })))
      .toBe("math");
  });

  it("propose le clavier mathématique pour un ensemble de valeurs", () => {
    expect(modeSaisie(rubric({ kind: "set", values: ["1", "2"], ordered: false })))
      .toBe("math");
  });

  it("laisse le clavier ordinaire quand la comparaison est textuelle", () => {
    // `exact` confronte des chaînes : imposer un éditeur de formules pour
    // écrire « croissante » ne ferait que gêner l'élève.
    expect(modeSaisie(rubric({ kind: "exact" }))).toBe("text");
  });

  it("retient le clavier mathématique en l'absence de barème", () => {
    expect(modeSaisie(null)).toBe("math");
    expect(modeSaisie(undefined)).toBe("math");
  });

  it("ne renvoie jamais autre chose que les deux natures de champ", () => {
    const modes: GradingRubric["mode"][] = [
      { kind: "exact" },
      { kind: "qcm", correctIndex: 0 },
      { kind: "true_false", correctValue: "true" },
      { kind: "symbolic", canonical: "x", variables: ["x"] },
      { kind: "numeric", value: 1, tolerance: 0, relative: false },
      { kind: "fraction", numerator: 1, denominator: 3, reduced: false },
      { kind: "set", values: ["a"], ordered: true },
    ];
    for (const m of modes) {
      expect(["math", "text"]).toContain(modeSaisie(rubric(m)));
    }
  });
});

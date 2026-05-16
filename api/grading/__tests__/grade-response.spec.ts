import { describe, it, expect, vi, beforeEach } from "vitest";
import { gradeResponse } from "../grade-response";
import type { GradeResponseArgs } from "../grade-response";
import type { GradingRubric } from "../../../contracts/grading-rubric";
import { gradeWithLLM } from "../llm-client";

/**
 * Tests de l'orchestrateur grade-response avec LLM mocké.
 */

vi.mock("../llm-client", () => ({
  gradeWithLLM: vi.fn(),
  clearLLMCache: vi.fn(),
  isLLMCached: vi.fn().mockReturnValue(false),
}));

const qcmRubric: GradingRubric = {
  mode: { kind: "qcm", correctIndex: 2 },
  llmReviewRequired: false,
  weight: 1,
};

const numericRubric: GradingRubric = {
  mode: { kind: "numeric", value: 2, tolerance: 1e-12, relative: false },
  acceptableForms: ["2", "2.0", "2,0", "+2"],
  llmReviewRequired: false,
  weight: 1,
};

const symbolicRubric: GradingRubric = {
  mode: { kind: "symbolic", canonical: "2*exp(2*x) - 3", variables: ["x"] },
  acceptableForms: ["2exp(2x)-3"],
  llmReviewRequired: false,
  weight: 1,
};

const fractionRubric: GradingRubric = {
  mode: { kind: "fraction", numerator: 17, denominator: 32, reduced: true },
  llmReviewRequired: false,
  weight: 1,
};

const trueFalseRubric: GradingRubric = {
  mode: { kind: "true_false", correctValue: "true" },
  llmReviewRequired: true,
  weight: 1,
  detailedRubric: "1pt réponse, 1pt justification.",
};

describe("gradeResponse — QCM", () => {
  it("index correct → score plein", async () => {
    const args: GradeResponseArgs = {
      questionType: "qcm",
      studentAnswer: "2",
      rubric: qcmRubric,
      questionText: "Quelle est la limite ?",
      maxPoints: 1,
      resolvedQcmIndex: 2,
    };
    const result = await gradeResponse(args);
    expect(result.score).toBe(1);
    expect(result.isCorrect).toBe(true);
    expect(result.gradingMode).toBe("qcm");
  });

  it("index incorrect → score 0", async () => {
    const args: GradeResponseArgs = {
      questionType: "qcm",
      studentAnswer: "0",
      rubric: qcmRubric,
      questionText: "Quelle est la limite ?",
      maxPoints: 1,
      resolvedQcmIndex: 0,
    };
    const result = await gradeResponse(args);
    expect(result.score).toBe(0);
    expect(result.isCorrect).toBe(false);
  });
});

describe("gradeResponse — numérique (Q11)", () => {
  it("forme acceptable '2' → score plein", async () => {
    const args: GradeResponseArgs = {
      questionType: "short_answer",
      studentAnswer: "2",
      rubric: numericRubric,
      questionText: "Limite de u_n",
      maxPoints: 2,
    };
    const result = await gradeResponse(args);
    expect(result.score).toBe(2);
    expect(result.isCorrect).toBe(true);
  });

  it("forme acceptable '+2' → score plein", async () => {
    const args: GradeResponseArgs = {
      questionType: "short_answer",
      studentAnswer: "+2",
      rubric: numericRubric,
      questionText: "Limite",
      maxPoints: 2,
    };
    const result = await gradeResponse(args);
    expect(result.score).toBe(2);
  });

  it("valeur incorrecte → score 0", async () => {
    const args: GradeResponseArgs = {
      questionType: "short_answer",
      studentAnswer: "3",
      rubric: numericRubric,
      questionText: "Limite",
      maxPoints: 2,
    };
    const result = await gradeResponse(args);
    expect(result.score).toBe(0);
    expect(result.isCorrect).toBe(false);
  });
});

describe("gradeResponse — symbolique (Q12)", () => {
  it("forme acceptable explicite '2exp(2x)-3' → score plein", async () => {
    const args: GradeResponseArgs = {
      questionType: "short_answer",
      studentAnswer: "2exp(2x)-3",
      rubric: symbolicRubric,
      questionText: "Calculer f'(x)",
      maxPoints: 2,
    };
    const result = await gradeResponse(args);
    expect(result.score).toBe(2);
    expect(result.gradingMode).toBe("acceptable_form");
  });

  it("forme équivalente '2*e^(2*x)-3' → score plein via comparateur symbolic", async () => {
    const args: GradeResponseArgs = {
      questionType: "short_answer",
      studentAnswer: "2*e^(2*x)-3",
      rubric: symbolicRubric,
      questionText: "Calculer f'(x)",
      maxPoints: 2,
    };
    const result = await gradeResponse(args);
    expect(result.score).toBe(2);
    expect(result.isCorrect).toBe(true);
  });
});

describe("gradeResponse — fraction (Q15)", () => {
  it("17/32 → score plein", async () => {
    const args: GradeResponseArgs = {
      questionType: "short_answer",
      studentAnswer: "17/32",
      rubric: fractionRubric,
      questionText: "Probabilité",
      maxPoints: 2,
    };
    const result = await gradeResponse(args);
    expect(result.score).toBe(2);
    expect(result.partialCreditApplied).toBe(false);
  });

  it("34/64 → pénalité 25% = 1.5 pts", async () => {
    const args: GradeResponseArgs = {
      questionType: "short_answer",
      studentAnswer: "34/64",
      rubric: fractionRubric,
      questionText: "Probabilité",
      maxPoints: 2,
    };
    const result = await gradeResponse(args);
    expect(result.score).toBe(1.5);
    expect(result.partialCreditApplied).toBe(true);
  });
});

describe("gradeResponse — vrai/faux avec LLM mocké (Q16–Q20)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("réponse 'vrai' correcte avec justification → score LLM", async () => {
    vi.mocked(gradeWithLLM).mockResolvedValue({ score: 2, feedback: "Bien.", confidence: 0.9 });

    const args: GradeResponseArgs = {
      questionType: "true_false",
      studentAnswer: "vrai",
      justification: "C'est le théorème de la limite monotone.",
      rubric: trueFalseRubric,
      questionText: "Toute suite croissante et majorée converge.",
      maxPoints: 2,
    };
    const result = await gradeResponse(args);
    expect(result.score).toBe(2);
    expect(result.gradingMode).toContain("true_false");
  });

  it("réponse 'faux' incorrecte → score 0 sans appel LLM", async () => {
    const args: GradeResponseArgs = {
      questionType: "true_false",
      studentAnswer: "faux",
      justification: "car la suite diverge",
      rubric: trueFalseRubric,
      questionText: "Toute suite croissante et majorée converge.",
      maxPoints: 2,
    };
    const result = await gradeResponse(args);
    expect(result.score).toBe(0);
    expect(vi.mocked(gradeWithLLM)).not.toHaveBeenCalled();
  });
});

describe("gradeResponse — réponse vide", () => {
  it("réponse vide → score 0", async () => {
    const args: GradeResponseArgs = {
      questionType: "short_answer",
      studentAnswer: "   ",
      rubric: numericRubric,
      questionText: "Limite",
      maxPoints: 2,
    };
    const result = await gradeResponse(args);
    expect(result.score).toBe(0);
  });
});

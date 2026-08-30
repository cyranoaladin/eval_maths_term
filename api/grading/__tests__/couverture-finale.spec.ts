/**
 * Les derniers chemins de correction jamais empruntés.
 *
 * Aucun n'est théorique : une rubrique incohérente enregistrée par erreur, une
 * règle de crédit partiel d'un genre non implémenté, un logarithme décimal,
 * des options de QCM stockées sous une forme inattendue. Tous décident d'une
 * note ou d'un refus de noter.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { compareNumeric } from "../compare-numeric";
import type { GradingRubric } from "@contracts/grading-rubric";

const gradeWithLLM = vi.hoisted(() => vi.fn());
vi.mock("../llm-client", () => ({ gradeWithLLM, isLlmConfigured: () => true }));

const { gradeResponse } = await import("../grade-response");

const base = { questionText: "Question de contrôle", maxPoints: 2 };
function rubric(p: Partial<GradingRubric> & Pick<GradingRubric, "mode">): GradingRubric {
  return { llmReviewRequired: false, weight: 2, ...p };
}

beforeEach(() => {
  gradeWithLLM.mockClear();
  gradeWithLLM.mockImplementation(async () => {
    throw new Error("LLM non sollicité dans ce test");
  });
});

describe("compareNumeric — logarithme décimal", () => {
  it("reconnaît le logarithme décimal de dix", () => {
    // « log » sans précision désigne le logarithme décimal dans l'usage
    // français : `\log(10)` vaut 1, pas ln(10).
    expect(compareNumeric({ value: 1, tolerance: 1e-9, relative: false }, "\\log(10)").equal).toBe(true);
  });
});

describe("gradeResponse — vrai/faux, message d'erreur", () => {
  it("rappelle la réponse attendue quand elle était « Faux »", async () => {
    const r = await gradeResponse({
      ...base, questionType: "true_false", studentAnswer: "vrai",
      rubric: rubric({ mode: { kind: "true_false", correctValue: "false" } }),
    });
    expect(r.isCorrect).toBe(false);
    expect(r.feedback).toMatch(/attendu : Faux/);
  });

  it("rappelle la réponse attendue quand elle était « Vrai »", async () => {
    const r = await gradeResponse({
      ...base, questionType: "true_false", studentAnswer: "faux",
      rubric: rubric({ mode: { kind: "true_false", correctValue: "true" } }),
    });
    expect(r.feedback).toMatch(/attendu : Vrai/);
  });
});

describe("gradeResponse — rubriques incohérentes sur une réponse courte", () => {
  it("ne note pas une réponse courte dont le barème est celui d'un QCM", async () => {
    // Donnée corrompue ou rubrique mal saisie : le moteur constate qu'il ne
    // peut pas comparer plutôt que d'inventer une note.
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "2",
      rubric: rubric({ mode: { kind: "qcm", correctIndex: 0 } }),
    });
    expect(r.score).toBe(0);
    expect(r.feedback).toMatch(/comparaison impossible/i);
  });

  it("ne note pas une réponse courte dont le barème est celui d'un vrai/faux", async () => {
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "vrai",
      rubric: rubric({ mode: { kind: "true_false", correctValue: "true" } }),
    });
    expect(r.feedback).toMatch(/comparaison impossible/i);
  });
});

describe("gradeResponse — crédit partiel", () => {
  it("ignore une règle dont le genre n'est pas implémenté", async () => {
    // `numericApprox` figure au contrat mais n'a pas de comparateur : mieux
    // vaut ne rien accorder que d'accorder au hasard.
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "3",
      rubric: rubric({
        mode: { kind: "numeric", value: 2, tolerance: 0, relative: false },
        partialCredit: [{ rule: "approche", score: 1, matcherKind: "numericApprox", pattern: "2" }],
      }),
    });
    expect(r.score).toBe(0);
  });

  it("ignore une règle d'équivalence sans motif exploitable", async () => {
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "trois",
      rubric: rubric({
        mode: { kind: "numeric", value: 2, tolerance: 0, relative: false },
        partialCredit: [{ rule: "valeur", score: 1, matcherKind: "fractionEquivalent", pattern: "pas-un-nombre" }],
      }),
    });
    expect(r.score).toBe(0);
  });

  it("ignore une règle de crédit partiel sans motif du tout", async () => {
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "3",
      rubric: rubric({
        mode: { kind: "numeric", value: 2, tolerance: 0, relative: false },
        partialCredit: [{ rule: "sans motif", score: 1, matcherKind: "regex" }],
      }),
    });
    expect(r.score).toBe(0);
  });
});

describe("gradeResponse — ce qui est transmis au correcteur assisté", () => {
  it("transmet la réponse de l'élève faute de référence dans le barème", async () => {
    // Un barème « fraction » ne porte pas de chaîne attendue : il n'y a rien
    // d'autre à donner au correcteur que ce que l'élève a écrit.
    gradeWithLLM.mockImplementation(async () => ({ score: 1, feedback: "Partiel.", confidence: 0.6 }));
    await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "presque 17/32",
      rubric: rubric({
        mode: { kind: "fraction", numerator: 17, denominator: 32, reduced: true },
        llmReviewRequired: true,
      }),
    });
    expect(gradeWithLLM.mock.calls[0][0].expectedAnswer).toBe("presque 17/32");
  });

  it("transmet la valeur numérique attendue quand le barème en porte une", async () => {
    gradeWithLLM.mockImplementation(async () => ({ score: 2, feedback: "Correct.", confidence: 0.9 }));
    await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "environ deux",
      rubric: rubric({
        mode: { kind: "numeric", value: 2.5, tolerance: 0, relative: false },
        llmReviewRequired: true,
      }),
    });
    expect(gradeWithLLM.mock.calls[0][0].expectedAnswer).toBe("2.5");
  });
});

describe("gradeResponse — justification non demandée", () => {
  it("signale qu'une justification fournie n'a pas été évaluée", async () => {
    // L'élève a justifié spontanément alors que le barème ne l'exigeait pas :
    // il garde ses points, et on lui dit que sa justification n'a pas été lue.
    const r = await gradeResponse({
      ...base, questionType: "true_false", studentAnswer: "vrai",
      justification: "car la fonction est croissante sur l'intervalle",
      rubric: rubric({ mode: { kind: "true_false", correctValue: "true" } }),
    });
    expect(r.score).toBe(2);
    expect(r.feedback).toMatch(/non évaluée automatiquement/);
  });
});

describe("gradeResponse — ensemble solution faux", () => {
  it("n'accorde aucun point à un ensemble incorrect", async () => {
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "{1;3}",
      rubric: rubric({ mode: { kind: "set", values: ["1", "2"], ordered: false } }),
    });
    expect(r.score).toBe(0);
    expect(r.isCorrect).toBe(false);
    expect(r.gradingMode).toBe("set");
  });
});

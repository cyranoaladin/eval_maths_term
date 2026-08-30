/**
 * Les chemins de `gradeResponse` que rien n'éprouvait : rubriques
 * incohérentes, vrai/faux avec justification, crédit partiel, recours au LLM
 * et ses pannes.
 *
 * Le LLM est simulé : ce qui est testé ici, ce n'est pas sa qualité, c'est la
 * décision du moteur autour de lui — notamment le fait qu'une panne du service
 * ne doit jamais faire perdre à l'élève les points qu'il a réellement acquis.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GradingRubric } from "@contracts/grading-rubric";

const gradeWithLLM = vi.hoisted(() => vi.fn());
vi.mock("../llm-client", () => ({
  gradeWithLLM,
  isLlmConfigured: () => true,
}));

const { gradeResponse } = await import("../grade-response");

const base = {
  questionText: "Question de contrôle",
  maxPoints: 2,
};

function rubric(partiel: Partial<GradingRubric> & Pick<GradingRubric, "mode">): GradingRubric {
  return { llmReviewRequired: false, weight: 2, ...partiel };
}

beforeEach(() => {
  gradeWithLLM.mockClear();
  // Par défaut, le service est indisponible : chaque test qui veut une
  // réponse du LLM doit le dire explicitement.
  gradeWithLLM.mockImplementation(async () => {
    throw new Error("LLM non sollicité dans ce test");
  });
});

describe("gradeResponse — rubriques incohérentes", () => {
  it("refuse un QCM dont le barème n'est pas un barème de QCM", async () => {
    const r = await gradeResponse({
      ...base, questionType: "qcm", studentAnswer: "0",
      rubric: rubric({ mode: { kind: "exact" } }), resolvedQcmIndex: 0,
    });
    expect(r.isCorrect).toBe(false);
    expect(r.feedback).toMatch(/rubric invalide/i);
  });

  it("refuse un QCM dont l'index n'a pas été reconverti", async () => {
    // Sans reconversion, la note serait tirée au sort : mieux vaut échouer net.
    const r = await gradeResponse({
      ...base, questionType: "qcm", studentAnswer: "0",
      rubric: rubric({ mode: { kind: "qcm", correctIndex: 1 } }),
    });
    expect(r.feedback).toMatch(/index qcm manquant/i);
  });

  it("refuse un vrai/faux dont le barème n'est pas un barème de vrai/faux", async () => {
    const r = await gradeResponse({
      ...base, questionType: "true_false", studentAnswer: "vrai",
      rubric: rubric({ mode: { kind: "exact" } }),
    });
    expect(r.feedback).toMatch(/rubric invalide/i);
  });
});

describe("gradeResponse — QCM", () => {
  const qcm = rubric({
    mode: { kind: "qcm", correctIndex: 1 },
    distractorDiagnostics: ["", "", "Vous avez confondu dérivée et primitive.", ""],
  });

  it("donne tous les points sur la bonne proposition", async () => {
    const r = await gradeResponse({ ...base, questionType: "qcm", studentAnswer: "1", rubric: qcm, resolvedQcmIndex: 1 });
    expect(r.score).toBe(2);
    expect(r.isCorrect).toBe(true);
  });

  it("rend le diagnostic du distracteur choisi", async () => {
    // Une mauvaise réponse doit enseigner quelque chose.
    const r = await gradeResponse({ ...base, questionType: "qcm", studentAnswer: "2", rubric: qcm, resolvedQcmIndex: 2 });
    expect(r.score).toBe(0);
    expect(r.feedback).toBe("Vous avez confondu dérivée et primitive.");
  });

  it("reste générique quand l'enseignant n'a pas documenté le distracteur", async () => {
    const r = await gradeResponse({ ...base, questionType: "qcm", studentAnswer: "3", rubric: qcm, resolvedQcmIndex: 3 });
    expect(r.feedback).toMatch(/incorrecte/i);
  });
});

describe("gradeResponse — vrai/faux", () => {
  const vf = rubric({ mode: { kind: "true_false", correctValue: "true" } });

  it("accepte les formulations usuelles d'un « vrai »", async () => {
    for (const forme of ["vrai", "true", "1", "oui", "V", " Vrai "]) {
      const r = await gradeResponse({ ...base, questionType: "true_false", studentAnswer: forme, rubric: vf });
      expect(r.isCorrect, forme).toBe(true);
    }
  });

  it("accepte les formulations usuelles d'un « faux »", async () => {
    const vfFaux = rubric({ mode: { kind: "true_false", correctValue: "false" } });
    for (const forme of ["faux", "false", "0", "non", "f"]) {
      const r = await gradeResponse({ ...base, questionType: "true_false", studentAnswer: forme, rubric: vfFaux });
      expect(r.isCorrect, forme).toBe(true);
    }
  });

  it("refuse une réponse qui n'est ni vrai ni faux", async () => {
    const r = await gradeResponse({ ...base, questionType: "true_false", studentAnswer: "peut-être", rubric: vf });
    expect(r.isCorrect).toBe(false);
    expect(r.feedback).toMatch(/non reconnue/i);
  });

  it("ne lit pas la justification quand la réponse est fausse", async () => {
    const r = await gradeResponse({
      ...base, questionType: "true_false", studentAnswer: "faux",
      justification: "une justification impeccable", rubric: { ...vf, llmReviewRequired: true },
    });
    expect(r.score).toBe(0);
    expect(gradeWithLLM).not.toHaveBeenCalled();
  });

  it("signale l'absence de justification sans pénaliser", async () => {
    const r = await gradeResponse({ ...base, questionType: "true_false", studentAnswer: "vrai", rubric: vf });
    expect(r.score).toBe(2);
    expect(r.feedback).toMatch(/aucune justification/i);
  });

  it("laisse la justification à l'enseignant en remise automatique", async () => {
    // Auto-submit : pas d'appel LLM synchrone, la latence serait inacceptable.
    const r = await gradeResponse({
      ...base, questionType: "true_false", studentAnswer: "vrai",
      justification: "car la fonction est croissante",
      rubric: { ...vf, llmReviewRequired: true }, skipLLM: true,
    });
    expect(r.needsLLM).toBe(true);
    expect(r.score).toBe(1);
    expect(gradeWithLLM).not.toHaveBeenCalled();
  });

  it("complète la note avec l'appréciation du LLM sur la justification", async () => {
    gradeWithLLM.mockResolvedValue({ score: 2, feedback: "Justification complète.", confidence: 0.9 });
    const r = await gradeResponse({
      ...base, questionType: "true_false", studentAnswer: "vrai",
      justification: "car la dérivée est positive", rubric: { ...vf, llmReviewRequired: true },
    });
    expect(r.score).toBe(2);
    expect(r.gradingMode).toBe("true_false+llm");
  });

  it("ne descend jamais sous les points acquis par la réponse elle-même", async () => {
    // Le LLM juge la justification, pas la réponse : elle est bonne, elle reste payée.
    gradeWithLLM.mockResolvedValue({ score: 0, feedback: "Justification hors sujet.", confidence: 0.8 });
    const r = await gradeResponse({
      ...base, questionType: "true_false", studentAnswer: "vrai",
      justification: "je ne sais pas", rubric: { ...vf, llmReviewRequired: true },
    });
    expect(r.score).toBe(1);
  });

  it("conserve les points de la réponse quand le service est en panne", async () => {
    gradeWithLLM.mockImplementation(async () => { throw new Error("service indisponible"); });
    const r = await gradeResponse({
      ...base, questionType: "true_false", studentAnswer: "vrai",
      justification: "car la dérivée est positive", rubric: { ...vf, llmReviewRequired: true },
    });
    expect(r.score).toBe(1);
    expect(r.gradingMode).toBe("true_false+llm_failed");
  });
});

describe("gradeResponse — réponse courte", () => {
  const num = rubric({ mode: { kind: "numeric", value: 2, tolerance: 1e-9, relative: false } });

  it("refuse une copie blanche", async () => {
    const r = await gradeResponse({ ...base, questionType: "short_answer", studentAnswer: "   ", rubric: num });
    expect(r.score).toBe(0);
    expect(r.feedback).toMatch(/vide/i);
  });

  it("accepte une forme explicitement prévue par l'enseignant", async () => {
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "deux",
      rubric: { ...num, acceptableForms: ["deux"] },
    });
    expect(r.gradingMode).toBe("acceptable_form");
    expect(r.score).toBe(2);
  });

  it("applique le crédit partiel prévu au barème", async () => {
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "0,53",
      rubric: rubric({
        mode: { kind: "fraction", numerator: 17, denominator: 32, reduced: true },
        partialCredit: [{ rule: "valeur décimale approchée", score: 1, matcherKind: "regex", pattern: "^0[.,]53" }],
      }),
    });
    expect(r.gradingMode).toBe("partial_credit");
    expect(r.score).toBe(1);
  });

  it("plafonne le crédit partiel au barème de la question", async () => {
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "0,53",
      rubric: rubric({
        mode: { kind: "fraction", numerator: 17, denominator: 32, reduced: true },
        partialCredit: [{ rule: "généreux", score: 99, matcherKind: "regex", pattern: "^0" }],
      }),
    });
    expect(r.score).toBe(2);
  });

  it("reconnaît une valeur décimale équivalente en crédit partiel", async () => {
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "0,5",
      rubric: rubric({
        mode: { kind: "fraction", numerator: 1, denominator: 3, reduced: true },
        partialCredit: [{ rule: "valeur d'un demi", score: 1, matcherKind: "fractionEquivalent", pattern: "0.5" }],
      }),
    });
    expect(r.score).toBe(1);
  });

  it("ignore une règle de crédit partiel mal écrite", async () => {
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "3",
      rubric: rubric({
        mode: { kind: "numeric", value: 2, tolerance: 0, relative: false },
        partialCredit: [{ rule: "motif cassé", score: 1, matcherKind: "regex", pattern: "(" }],
      }),
    });
    expect(r.score).toBe(0);
  });

  it("laisse la copie à l'enseignant en remise automatique quand le LLM est requis", async () => {
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "quelque chose",
      rubric: { ...num, llmReviewRequired: true }, skipLLM: true,
    });
    expect(r.needsLLM).toBe(true);
    expect(r.gradingMode).toBe("pending_llm");
    expect(gradeWithLLM).not.toHaveBeenCalled();
  });

  it("recourt au LLM quand le barème le demande et que le comparateur a échoué", async () => {
    gradeWithLLM.mockResolvedValue({ score: 1, feedback: "Raisonnement partiellement juste.", confidence: 0.7 });
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "environ 2,1",
      rubric: { ...num, llmReviewRequired: true },
    });
    expect(r.gradingMode).toBe("llm");
    expect(r.partialCreditApplied).toBe(true);
  });

  it("transmet au LLM la référence symbolique du barème", async () => {
    gradeWithLLM.mockResolvedValue({ score: 2, feedback: "Correct.", confidence: 0.95 });
    await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "autre chose",
      rubric: rubric({ mode: { kind: "symbolic", canonical: "2*x", variables: ["x"] }, llmReviewRequired: true }),
    });
    expect(gradeWithLLM.mock.calls[0][0].expectedAnswer).toBe("2*x");
  });

  it("ne met pas la copie à zéro quand le service est en panne", async () => {
    gradeWithLLM.mockImplementation(async () => { throw new Error("timeout"); });
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "environ 2",
      rubric: { ...num, llmReviewRequired: true },
    });
    expect(r.feedback).toMatch(/manuellement/i);
  });

  it("corrige un ensemble solution", async () => {
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "{1;2}",
      rubric: rubric({ mode: { kind: "set", values: ["1", "2"], ordered: false } }),
    });
    expect(r.gradingMode).toBe("set");
    expect(r.isCorrect).toBe(true);
  });

  it("constate l'impossibilité de comparer plutôt que d'inventer une note", async () => {
    // Barème « exact » sans forme acceptée : rien ne peut être reconnu.
    const r = await gradeResponse({
      ...base, questionType: "short_answer", studentAnswer: "croissante",
      rubric: rubric({ mode: { kind: "exact" } }),
    });
    expect(r.score).toBe(0);
    expect(r.feedback).toMatch(/comparaison impossible/i);
  });
});

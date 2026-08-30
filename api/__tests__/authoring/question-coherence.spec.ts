/**
 * Cohérence d'une question à l'écriture.
 *
 * Le défaut visé est silencieux : une question dont `correctAnswer` et
 * `gradingRubric.mode` divergent s'enregistre, se relit normalement dans
 * l'éditeur, et note faux — parce que le moteur ne consulte que la rubric.
 */
import { describe, expect, it } from "vitest";
import { validateQuestionCoherence, type QuestionDraft } from "@contracts/question-coherence";

function qcm(overrides: Partial<QuestionDraft> = {}): QuestionDraft {
  return {
    type: "qcm",
    question: "La limite de $f$ en $+\\infty$ est :",
    options: ["$0$", "$1$", "$2$", "$+\\infty$"],
    correctAnswer: "2",
    points: 1,
    gradingRubric: {
      mode: { kind: "qcm", correctIndex: 2 },
      llmReviewRequired: false,
      weight: 1,
    },
    ...overrides,
  };
}

describe("QCM", () => {
  it("accepte une question cohérente", () => {
    expect(validateQuestionCoherence(qcm())).toEqual({ ok: true });
  });

  it("refuse une fiche qui contredit le barème", () => {
    const r = validateQuestionCoherence(qcm({ correctAnswer: "1" }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join()).toMatch(/Incohérence.*barème qui note/);
  });

  it("refuse un index de bonne réponse hors des propositions", () => {
    const r = validateQuestionCoherence(
      qcm({
        correctAnswer: "7",
        gradingRubric: { mode: { kind: "qcm", correctIndex: 7 }, llmReviewRequired: false, weight: 1 },
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join()).toMatch(/proposition 8.*n'y en a que 4/);
  });

  it("refuse moins de deux propositions", () => {
    const r = validateQuestionCoherence(
      qcm({
        options: ["$2$"],
        correctAnswer: "0",
        gradingRubric: { mode: { kind: "qcm", correctIndex: 0 }, llmReviewRequired: false, weight: 1 },
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join()).toMatch(/au moins deux propositions/);
  });

  it("refuse deux propositions identiques", () => {
    const r = validateQuestionCoherence(qcm({ options: ["$0$", "$1$", "$2$", "$2$"] }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join()).toMatch(/identiques/);
  });

  it("refuse une proposition vide", () => {
    const r = validateQuestionCoherence(qcm({ options: ["$0$", "  ", "$2$", "$4$"] }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join()).toMatch(/ne peut être vide/);
  });

  it("refuse un barème d'un autre type", () => {
    const r = validateQuestionCoherence(
      qcm({ gradingRubric: { mode: { kind: "exact" }, llmReviewRequired: false, weight: 1 } }),
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join()).toMatch(/exige un barème de type « qcm »/);
  });
});

describe("Vrai / Faux", () => {
  const tf = (o: Partial<QuestionDraft> = {}): QuestionDraft => ({
    type: "true_false",
    question: "Toute fonction dérivable est continue.",
    correctAnswer: "true",
    points: 2,
    gradingRubric: {
      mode: { kind: "true_false", correctValue: "true" },
      llmReviewRequired: true,
      weight: 2,
    },
    ...o,
  });

  it("accepte une question cohérente", () => {
    expect(validateQuestionCoherence(tf())).toEqual({ ok: true });
  });

  it("refuse une fiche qui contredit le barème", () => {
    const r = validateQuestionCoherence(tf({ correctAnswer: "false" }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join()).toMatch(/Incohérence/);
  });

  it("refuse des propositions sur un vrai/faux", () => {
    const r = validateQuestionCoherence(tf({ options: ["Vrai", "Faux"] }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join()).toMatch(/ne porte pas de propositions/);
  });
});

describe("Réponse courte", () => {
  const sa = (o: Partial<QuestionDraft> = {}): QuestionDraft => ({
    type: "short_answer",
    question: "Calculer $\\int_0^1 x\\,dx$.",
    correctAnswer: "1/2",
    points: 2,
    gradingRubric: {
      mode: { kind: "fraction", numerator: 1, denominator: 2, reduced: true },
      llmReviewRequired: false,
      weight: 2,
    },
    ...o,
  });

  it("accepte les modes de comparaison mathématiques", () => {
    expect(validateQuestionCoherence(sa())).toEqual({ ok: true });
    expect(
      validateQuestionCoherence(
        sa({
          gradingRubric: {
            mode: { kind: "numeric", value: 0.5, tolerance: 0.01, relative: false },
            llmReviewRequired: false,
            weight: 2,
          },
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("refuse un barème de QCM sur une réponse courte", () => {
    const r = validateQuestionCoherence(
      sa({
        gradingRubric: { mode: { kind: "qcm", correctIndex: 0 }, llmReviewRequired: false, weight: 2 },
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join()).toMatch(/exige un barème parmi/);
  });

  it("refuse une réponse attendue vide", () => {
    const r = validateQuestionCoherence(sa({ correctAnswer: "   " }));
    expect(r.ok).toBe(false);
  });
});

describe("Règles communes", () => {
  it("refuse un énoncé vide", () => {
    const r = validateQuestionCoherence(qcm({ question: "  " }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join()).toMatch(/énoncé ne peut pas être vide/);
  });

  it("refuse un barème nul ou négatif", () => {
    const r = validateQuestionCoherence(
      qcm({ points: 0, gradingRubric: { mode: { kind: "qcm", correctIndex: 2 }, llmReviewRequired: false, weight: 0 } }),
    );
    expect(r.ok).toBe(false);
  });

  it("refuse un poids de barème qui ne suit pas les points", () => {
    // `weight` n'est lu par aucun correcteur : on l'aligne pour qu'il ne mente pas.
    const r = validateQuestionCoherence(qcm({ points: 3 }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join()).toMatch(/poids du barème \(1\).*égal.*\(3\)/);
  });

  it("refuse une rubric structurellement invalide", () => {
    const r = validateQuestionCoherence(
      qcm({ gradingRubric: { mode: { kind: "inconnu" } } as never }),
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.join()).toMatch(/Barème de correction invalide/);
  });

  it("accumule plusieurs erreurs en une passe", () => {
    const r = validateQuestionCoherence(qcm({ question: "", points: 5, correctAnswer: "0" }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.errors.length).toBeGreaterThanOrEqual(3);
  });
});

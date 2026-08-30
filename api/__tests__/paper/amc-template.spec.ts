/**
 * Génération du document LaTeX AMC.
 *
 * Deux exigences dominent :
 * 1. Aucun mélange — sans quoi la saisie manuelle devient ininterprétable et
 *    la correspondance directe utilisée pour les copies papier note au hasard.
 * 2. Les énoncés sont du LaTeX inséré tel quel : les échapper casserait les
 *    formules, mais compiler du LaTeX arbitraire côté serveur doit rester sûr.
 */
import { describe, expect, it } from "vitest";
import {
  buildAmcDocument,
  assertSafeLatex,
  escapeLatexText,
  UnsafeLatexError,
  type TemplateInput,
  type TemplateQuestion,
} from "../../paper/amc-template";

const QCM: TemplateQuestion = {
  id: 1,
  type: "qcm",
  question: "La limite de $f(x)=\\dfrac{3x^2}{x^2+5}$ en $+\\infty$ vaut :",
  options: ["$+\\infty$", "$0$", "$3$", "$\\dfrac{1}{5}$"],
  order: 1,
  points: 1,
  gradingRubric: { mode: { kind: "qcm", correctIndex: 2 }, llmReviewRequired: false, weight: 1 },
};

const VF: TemplateQuestion = {
  id: 2,
  type: "true_false",
  question: "Toute suite croissante et majorée converge.",
  options: null,
  order: 2,
  points: 2,
  gradingRubric: {
    mode: { kind: "true_false", correctValue: "true" },
    llmReviewRequired: false,
    weight: 2,
  },
};

const OUVERTE: TemplateQuestion = {
  id: 3,
  type: "short_answer",
  question: "Calculer $\\int_0^1 x\\,dx$.",
  options: null,
  order: 3,
  points: 2,
  gradingRubric: { mode: { kind: "exact" }, llmReviewRequired: false, weight: 2 },
};

function input(overrides: Partial<TemplateInput> = {}): TemplateInput {
  return {
    title: "QCM Automatismes",
    durationMinutes: 45,
    questions: [QCM, VF],
    students: [
      { lastName: "DUPONT", firstName: "Marie" },
      { lastName: "BEN ALI", firstName: "Youcef" },
    ],
    ...overrides,
  };
}

describe("structure du document", () => {
  it("produit un document complet et compilable en apparence", () => {
    const { tex } = buildAmcDocument(input());
    expect(tex).toContain("\\documentclass[a4paper]{article}");
    expect(tex).toContain("automultiplechoice");
    expect(tex).toContain("\\begin{document}");
    expect(tex).toContain("\\end{document}");
    expect(tex).toContain("\\AMCform");
  });

  it("émet une copie par élève via le CSV", () => {
    const { tex, studentsCsv } = buildAmcDocument(input());
    expect(tex).toContain("\\csvreader");
    expect(tex).toContain("\\onecopy{1}");
    expect(tex).toContain("\\AMCassociation{\\Eleves}");
    // Sans guillemets : csvsimple ne les retire pas et ils s'imprimeraient
    // tels quels sur la feuille-réponses.
    expect(studentsCsv.split("\n")).toEqual([
      "Eleves",
      "DUPONT Marie",
      "BEN ALI Youcef",
    ]);
  });

  it("conserve la feuille-réponses séparée", () => {
    const { tex } = buildAmcDocument(input());
    expect(tex).toContain("separateanswersheet");
    expect(tex).toContain("\\AMCformBegin");
    expect(tex).toContain("\\namefield");
  });
});

describe("aucun mélange", () => {
  it("n'appelle jamais shufflegroup", () => {
    const { tex } = buildAmcDocument(input());
    expect(tex).not.toContain("\\shufflegroup");
  });

  it("déclare les propositions en ordre conservé", () => {
    const { tex } = buildAmcDocument(input());
    // `[o]` désactive le mélange des réponses par AMC.
    expect(tex).toContain("\\begin{choices}[o]");
    expect(tex).not.toMatch(/\\begin\{choices\}(?!\[o\])/);
  });

  it("imprime les propositions dans l'ordre de la base", () => {
    const { tex } = buildAmcDocument(input());
    const bloc = tex.slice(tex.indexOf("q1"), tex.indexOf("q2"));
    const positions = QCM.options!.map((o) => bloc.indexOf(o));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("marque la bonne réponse au bon rang", () => {
    const { tex } = buildAmcDocument(input());
    const bloc = tex.slice(tex.indexOf("q1"), tex.indexOf("q2"));
    expect(bloc).toContain("\\correctchoice{$3$}");
    expect(bloc).toContain("\\wrongchoice{$+\\infty$}");
  });

  it("respecte l'ordre des questions même si la liste arrive désordonnée", () => {
    const { tex, includedQuestionIds } = buildAmcDocument(
      input({ questions: [VF, QCM] }),
    );
    expect(includedQuestionIds).toEqual([1, 2]);
    expect(tex.indexOf("q1")).toBeLessThan(tex.indexOf("q2"));
  });
});

describe("questions non grillables", () => {
  it("écarte les réponses courtes en disant pourquoi", () => {
    const r = buildAmcDocument(input({ questions: [QCM, VF, OUVERTE] }));
    expect(r.includedQuestionIds).toEqual([1, 2]);
    expect(r.excluded).toEqual([
      { id: 3, reason: "Réponse courte : non grillable, à corriger séparément." },
    ]);
  });

  it("écarte une question sans barème : la bonne réponse est inconnue", () => {
    const r = buildAmcDocument(input({ questions: [{ ...QCM, gradingRubric: null }] }));
    expect(r.includedQuestionIds).toEqual([]);
    expect(r.excluded[0].reason).toMatch(/Barème manquant/);
  });

  it("écarte un QCM à moins de deux propositions", () => {
    const r = buildAmcDocument(input({ questions: [{ ...QCM, options: ["$3$"] }] }));
    expect(r.excluded[0].reason).toMatch(/sans propositions/);
  });
});

describe("sûreté du LaTeX", () => {
  it("laisse passer les mathématiques", () => {
    expect(() =>
      assertSafeLatex("$\\dfrac{1}{2}$ et $\\mathbb{R}$ et $\\int_0^1$", 1),
    ).not.toThrow();
  });

  it("refuse les primitives d'exécution", () => {
    // `\write18` permet de lancer des commandes système à la compilation.
    for (const p of ["\\write18{rm -rf /}", "\\immediate\\openout1=x", "\\input{/etc/passwd}"]) {
      expect(() => assertSafeLatex(p, 7)).toThrow(UnsafeLatexError);
    }
  });

  it("refuse une sortie prématurée du document", () => {
    expect(() => assertSafeLatex("fin \\end{document} suite", 7)).toThrow(/interdit/);
  });

  it("nomme la question fautive", () => {
    try {
      assertSafeLatex("\\write18{id}", 42);
      expect.unreachable();
    } catch (e) {
      expect((e as UnsafeLatexError).questionId).toBe(42);
    }
  });

  it("contrôle aussi les propositions, pas seulement l'énoncé", () => {
    expect(() =>
      buildAmcDocument(input({ questions: [{ ...QCM, options: ["$1$", "\\input{secret}"] }] })),
    ).toThrow(UnsafeLatexError);
  });

  it("échappe les textes qui ne sont pas du LaTeX", () => {
    expect(escapeLatexText("Maths & Physique 100% #1")).toBe(
      "Maths \\& Physique 100\\% \\#1",
    );
  });

  it("neutralise les caractères qui casseraient le CSV", () => {
    const { studentsCsv } = buildAmcDocument(
      input({ students: [{ lastName: 'MARTIN; "Le"', firstName: "Anne\nB" }] }),
    );
    const ligne = studentsCsv.split("\n")[1];
    expect(ligne).not.toMatch(/[;"]/);
    expect(ligne).toBe("MARTIN Le Anne B");
    expect(studentsCsv.split("\n")).toHaveLength(2);
  });
});

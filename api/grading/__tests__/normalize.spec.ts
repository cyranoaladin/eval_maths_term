import { describe, it, expect } from "vitest";
import { normalizeExpression } from "../normalize";

/**
 * 50+ cas couvrant toutes les acceptableForms des Q11–Q15
 * ainsi que les règles de normalisation du brief §VII.2.
 */

describe("normalizeExpression — règles de base", () => {
  it("supprime les espaces normaux", () => {
    expect(normalizeExpression("2 * x + 1")).toBe("2*x+1");
  });

  it("supprime les espaces insécables U+00A0", () => {
    expect(normalizeExpression("2\u00A0x")).toBe("2*x");
  });

  it("virgule décimale française → point (entre chiffres)", () => {
    expect(normalizeExpression("0,53125")).toBe("0.53125");
  });

  it("virgule décimale FR : transforme la virgule entre chiffres (même dans un ensemble)", () => {
    // {1,2} → {1.2} car 1 et 2 sont des chiffres — comportement attendu
    // Les ensembles utilisent le point-virgule {1;2} en notation FR mathématique
    expect(normalizeExpression("{1,2}")).toBe("{1.2}");
    // Avec point-virgule, pas de transformation
    expect(normalizeExpression("{1;2}")).toBe("{1;2}");
  });

  it("× → *", () => {
    expect(normalizeExpression("2×x")).toBe("2*x");
  });

  it("· → *", () => {
    expect(normalizeExpression("2·x")).toBe("2*x");
  });

  it("÷ → /", () => {
    expect(normalizeExpression("4÷2")).toBe("4/2");
  });

  it("π → pi", () => {
    expect(normalizeExpression("2π")).toBe("2*pi");
  });

  it("\\pi → pi", () => {
    expect(normalizeExpression("\\pi")).toBe("pi");
  });

  it("² → ^2", () => {
    expect(normalizeExpression("x²")).toBe("x^2");
  });

  it("³ → ^3", () => {
    expect(normalizeExpression("x³")).toBe("x^3");
  });

  it("√( → sqrt(", () => {
    expect(normalizeExpression("√(2)")).toBe("sqrt(2)");
  });

  it("\\sqrt{x} → sqrt(x)", () => {
    expect(normalizeExpression("\\sqrt{x}")).toBe("sqrt(x)");
  });

  it("\\ln → log", () => {
    expect(normalizeExpression("\\ln(2)")).toBe("log(2)");
  });

  it("\\exp → exp", () => {
    expect(normalizeExpression("\\exp(x)")).toBe("exp(x)");
  });

  it("\\frac{a}{b} → ((a)/(b))", () => {
    expect(normalizeExpression("\\frac{1}{2}")).toBe("((1)/(2))");
  });

  it("\\dfrac{a}{b} → ((a)/(b))", () => {
    expect(normalizeExpression("\\dfrac{3}{4}")).toBe("((3)/(4))");
  });

  it("exposant LaTeX x^{2} → x^(2)", () => {
    expect(normalizeExpression("x^{2}")).toBe("x^(2)");
  });

  it("e^x → exp(x) — notation simple", () => {
    expect(normalizeExpression("e^x")).toBe("exp(x)");
  });

  it("e^(2x) → exp(2x)", () => {
    expect(normalizeExpression("e^(2x)")).toBe("exp(2*x)");
  });

  it("multiplication implicite 2x → 2*x", () => {
    expect(normalizeExpression("2x")).toBe("2*x");
  });

  it("multiplication implicite 3(x+1) → 3*(x+1)", () => {
    expect(normalizeExpression("3(x+1)")).toBe("3*(x+1)");
  });

  it("signe + en tête supprimé : +2 → 2", () => {
    expect(normalizeExpression("+2")).toBe("2");
  });

  it("lowercase final : EXP(X) → exp(x)", () => {
    expect(normalizeExpression("EXP(X)")).toBe("exp(x)");
  });
});

describe("normalizeExpression — acceptableForms Q11 : limite = 2", () => {
  const expected = normalizeExpression("2");

  it("'2' → '2'", () => expect(normalizeExpression("2")).toBe(expected));
  it("'2.0' → '2.0' (même valeur normalisée)", () => {
    expect(normalizeExpression("2.0")).toBe("2.0");
  });
  it("'2,0' → '2.0'", () => expect(normalizeExpression("2,0")).toBe("2.0"));
  it("'+2' → '2'", () => expect(normalizeExpression("+2")).toBe(expected));
  it("'2/1' → '2/1' (géré par compare-fraction)", () => {
    expect(normalizeExpression("2/1")).toBe("2/1");
  });
});

describe("normalizeExpression — acceptableForms Q12 : 2*exp(2*x)-3", () => {
  const forms = [
    ["2*exp(2*x)-3", "2*exp(2*x)-3"],
    ["2exp(2x)-3", "2*exp(2*x)-3"],
    ["2 exp(2x) - 3", "2*exp(2*x)-3"],
    ["-3+2exp(2x)", "-3+2*exp(2*x)"],
    ["2e^(2x)-3", "2*exp(2*x)-3"],
    ["2e^{2x}-3", "2*exp(2*x)-3"],
    ["-3 + 2 e^{2 x}", "-3+2*exp(2*x)"],
  ];

  for (const [input, expected] of forms) {
    it(`'${input}' → '${expected}'`, () => {
      expect(normalizeExpression(input)).toBe(expected);
    });
  }
});

describe("normalizeExpression — acceptableForms Q13 : ln(2)", () => {
  it("'ln(2)' → 'log(2)'", () => expect(normalizeExpression("ln(2)")).toBe("log(2)"));
  it("'ln 2' → 'log(2)' (espace supprimé puis parenthèses ajoutées)", () => {
    expect(normalizeExpression("ln 2")).toBe("log(2)");
  });
  it("'ln2' → 'log(2)'", () => expect(normalizeExpression("ln2")).toBe("log(2)"));
  it("'\\ln(2)' → 'log(2)'", () => expect(normalizeExpression("\\ln(2)")).toBe("log(2)"));
  it("'\\ln 2' → 'log(2)'", () => expect(normalizeExpression("\\ln 2")).toBe("log(2)"));
  it("'log(2)' → 'log(2)' (déjà correct)", () => expect(normalizeExpression("log(2)")).toBe("log(2)"));
});

describe("normalizeExpression — acceptableForms Q14 : 2-exp(-2*x)", () => {
  const forms = [
    ["2-exp(-2*x)", "2-exp(-2*x)"],
    ["2-e^(-2x)", "2-exp(-2*x)"],
    ["-exp(-2x)+2", "-exp(-2*x)+2"],
    ["2 - e^{-2x}", "2-exp(-2*x)"],
    ["2-e^(-2*x)", "2-exp(-2*x)"],
    ["-e^(-2x) + 2", "-exp(-2*x)+2"],
  ];

  for (const [input, expected] of forms) {
    it(`'${input}' → '${expected}'`, () => {
      expect(normalizeExpression(input)).toBe(expected);
    });
  }
});

describe("normalizeExpression — règles supplémentaires", () => {
  it("\\sin → sin", () => {
    expect(normalizeExpression("\\sin(x)")).toBe("sin(x)");
  });

  it("\\cos → cos", () => {
    expect(normalizeExpression("\\cos(x)")).toBe("cos(x)");
  });

  it("\\mathrm{ln} → log (via expansion puis remplacement ln)", () => {
    expect(normalizeExpression("\\mathrm{ln}(2)")).toBe("log(2)");
  });

  it("fractions imbriquées une profondeur", () => {
    expect(normalizeExpression("\\frac{x+1}{x-1}")).toBe("((x+1)/(x-1))");
  });

  it("exposants multi-chiffres x^{12} → x^(12)", () => {
    expect(normalizeExpression("x^{12}")).toBe("x^(12)");
  });

  it("expression vide → vide", () => {
    expect(normalizeExpression("")).toBe("");
  });

  it("expression avec espaces multiples", () => {
    expect(normalizeExpression("  2  *  x  ")).toBe("2*x");
  });
});

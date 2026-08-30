/**
 * Chemins de correction rarement empruntés mais bien réels.
 *
 * Ce ne sont pas des tests de couverture décorative : chacun correspond à une
 * copie plausible. Une division par zéro écrite par un élève, une réponse
 * infinie, un ensemble mal fermé, une expression que mathjs ne sait pas
 * évaluer — tous ces cas décident d'une note, et aucun n'était éprouvé.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { compareExact } from "../compare-exact";
import { compareFraction } from "../compare-fraction";
import { compareNumeric } from "../compare-numeric";
import { compareSet } from "../compare-set";
import { areSymbolicallyEqual } from "../compare-symbolic";
import { normalizeExpression, normalizeAndDetectRejected } from "../normalize";
import { buildGradingPrompt } from "../grading-prompt";

describe("compareExact — parenthèses superflues", () => {
  it("accepte une réponse entièrement parenthésée", () => {
    // Un élève qui recopie « (2x+1) » depuis son brouillon ne mérite pas zéro.
    expect(compareExact("2x+1", "(2x+1)").equal).toBe(true);
  });

  it("refuse toujours deux expressions différentes", () => {
    expect(compareExact("2x+1", "(2x+2)").equal).toBe(false);
  });
});

describe("compareFraction — cas limites", () => {
  it("refuse une division par zéro", () => {
    const r = compareFraction({ numerator: 1, denominator: 2, reduced: true }, "1/0");
    expect(r.equal).toBe(false);
  });

  it("accepte la valeur décimale exacte avec pénalité", () => {
    const r = compareFraction({ numerator: 1, denominator: 2, reduced: true }, "0,5");
    expect(r.equal).toBe(true);
    expect(r.penalty).toBeGreaterThan(0);
  });

  it("refuse une décimale qui n'est pas la bonne valeur", () => {
    expect(compareFraction({ numerator: 1, denominator: 2, reduced: true }, "0,6").equal).toBe(false);
  });
});

describe("compareNumeric — constantes et valeurs non finies", () => {
  const av = (value: number) => ({ value, tolerance: 1e-9, relative: false });

  it("reconnaît les constantes usuelles", () => {
    expect(compareNumeric(av(Math.PI), "pi").equal).toBe(true);
    expect(compareNumeric(av(Math.E), "e").equal).toBe(true);
    expect(compareNumeric(av(Math.log(3)), "ln(3)").equal).toBe(true);
    expect(compareNumeric(av(Math.log(5)), "ln(5)").equal).toBe(true);
    expect(compareNumeric(av(Math.log(10)), "ln(10)").equal).toBe(true);
    expect(compareNumeric(av(Math.log(4)), "ln(4)").equal).toBe(true);
    expect(compareNumeric(av(Math.SQRT2), "sqrt(2)").equal).toBe(true);
  });

  it("traite une limite infinie", () => {
    // `Infinity` attendu : la limite est bien infinie, la réponse est juste.
    expect(compareNumeric(av(Infinity), "\\infty").equal).toBe(true);
    // Infini donné là où une valeur finie était attendue : refus explicite.
    const r = compareNumeric(av(2), "\\infty");
    expect(r.equal).toBe(false);
    expect(r.reason).toMatch(/non finie/i);
  });

  it("distingue le moins l'infini", () => {
    expect(compareNumeric(av(-Infinity), "-\\infty").equal).toBe(true);
    expect(compareNumeric(av(Infinity), "-\\infty").equal).toBe(false);
  });

  it("applique une tolérance relative quand le barème le demande", () => {
    const r = compareNumeric({ value: 1000, tolerance: 0.01, relative: true }, "1005");
    expect(r.equal).toBe(true);
    expect(compareNumeric({ value: 1000, tolerance: 0.01, relative: true }, "1200").equal).toBe(false);
  });
});

describe("compareSet — écritures dégradées", () => {
  it("traite un ensemble vide écrit de plusieurs façons", () => {
    const vide = { values: [], ordered: false };
    expect(compareSet(vide, "{}").equal).toBe(true);
    expect(compareSet(vide, "vide").equal).toBe(true);
    expect(compareSet(vide, "empty").equal).toBe(true);
  });

  it("accepte les crochets et les points-virgules", () => {
    expect(compareSet({ values: ["1", "2"], ordered: false }, "[1; 2]").equal).toBe(true);
  });

  it("signale les éléments manquants et en trop", () => {
    const r = compareSet({ values: ["1", "2"], ordered: false }, "{1, 3}");
    expect(r.equal).toBe(false);
    expect(r.missing).toContain("2");
    expect(r.extra).toContain("3");
  });

  it("refuse un ensemble ordonné de mauvaise longueur", () => {
    const r = compareSet({ values: ["1", "2"], ordered: true }, "{1}");
    expect(r.equal).toBe(false);
    expect(r.reason).toMatch(/nombre d'éléments/i);
  });

  it("compare textuellement ce qui n'a pas de valeur numérique", () => {
    const r = compareSet({ values: ["x", "y"], ordered: false }, "{x, y}");
    expect(r.equal).toBe(true);
    expect(compareSet({ values: ["x", "y"], ordered: false }, "{x, z}").equal).toBe(false);
  });
});

describe("areSymbolicallyEqual — échecs d'évaluation", () => {
  it("refuse une expression que mathjs ne sait pas lire", async () => {
    const r = await areSymbolicallyEqual("2*x", "?!!", ["x"]);
    expect(r.equal).toBe(false);
  });

  it("refuse deux fonctions qui divergent en plusieurs points", async () => {
    const r = await areSymbolicallyEqual("x^2", "x^3", ["x"]);
    expect(r.equal).toBe(false);
    expect(r.strategy).toBe("numeric");
  });

  it("accepte deux écritures de la même fonction", async () => {
    const r = await areSymbolicallyEqual("(x+1)^2", "x^2+2*x+1", ["x"]);
    expect(r.equal).toBe(true);
  });
});

describe("normalizeAndDetectRejected", () => {
  it("signale une notation proscrite par le barème", () => {
    // Exemple réel : exiger la valeur exacte, donc refuser l'écriture décimale.
    const r = normalizeAndDetectRejected("0,69", ["^0[.,]6"]);
    expect(r.rejectedMatches).toHaveLength(1);
    expect(r.normalized).toBe("0.69");
  });

  it("ignore un motif de rejet mal écrit plutôt que de planter la correction", () => {
    // Une rubrique fautive ne doit pas empêcher la copie d'être notée.
    const r = normalizeAndDetectRejected("2x", ["(non fermé"]);
    expect(r.rejectedMatches).toEqual([]);
    expect(r.normalized).toBe("2*x");
  });

  it("ne signale rien quand la notation est acceptable", () => {
    expect(normalizeAndDetectRejected("ln(2)", ["^0[.,]"]).rejectedMatches).toEqual([]);
  });
});

describe("buildGradingPrompt", () => {
  const base = {
    question: "Calculez la limite.",
    expectedAnswer: "2",
    studentAnswer: "2",
    questionType: "short_answer" as const,
    maxPoints: 2,
    detailedRubric: "Valeur exacte attendue.",
  };

  const texte = (messages: { role: string; content: string }[]) =>
    messages.map((m) => m.content).join("\n");

  it("inclut la justification quand l'élève en a donné une", () => {
    const p = texte(buildGradingPrompt({ ...base, justification: "car le numérateur domine" }));
    expect(p).toContain("car le numérateur domine");
  });

  it("reste lisible quand la réponse est vide", () => {
    const p = texte(buildGradingPrompt({ ...base, studentAnswer: "" }));
    expect(p).toContain("(vide)");
  });
});

describe("normalizeExpression — écritures Unicode des copies scannées", () => {
  let avertissements: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    avertissements = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => avertissements.mockRestore());

  it("traduit les symboles que produisent les traitements de texte", () => {
    expect(normalizeExpression("2×3")).toBe("2*3");
    expect(normalizeExpression("6÷2")).toBe("6/2");
    expect(normalizeExpression("x²")).toBe("x^2");
    expect(normalizeExpression("π")).toBe("pi");
    expect(normalizeExpression("√4")).toBe("sqrt(4)");
  });
});

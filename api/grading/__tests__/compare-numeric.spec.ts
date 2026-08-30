import { describe, it, expect } from "vitest";
import { compareNumeric } from "../compare-numeric";

describe("compareNumeric — Q11 : limite = 2", () => {
  const expected = { value: 2, tolerance: 1e-12, relative: false };

  const correct = ["2", "2.0", "2,0", "+2", "2/1"];
  for (const form of correct) {
    it(`accepte "${form}"`, () => {
      expect(compareNumeric(expected, form).equal).toBe(true);
    });
  }

  it("rejette 3", () => expect(compareNumeric(expected, "3").equal).toBe(false));
  it("rejette 1.9999", () => expect(compareNumeric(expected, "1.9999").equal).toBe(false));
  it("rejette chaîne non numérique", () => {
    expect(compareNumeric(expected, "abc").equal).toBe(false);
  });
});

describe("compareNumeric — Q13 : ln(2)", () => {
  const expected = { value: Math.LN2, tolerance: 1e-9, relative: false };

  it("accepte 'ln(2)'", () => {
    expect(compareNumeric(expected, "ln(2)").equal).toBe(true);
  });

  it("accepte 'log(2)' (mathjs log = ln naturel)", () => {
    expect(compareNumeric(expected, "log(2)").equal).toBe(true);
  });

  it("accepte approximation décimale 0.693147 dans tolérance 1e-6", () => {
    const looseTol = { value: Math.LN2, tolerance: 1e-5, relative: false };
    expect(compareNumeric(looseTol, "0.693147").equal).toBe(true);
  });

  it("rejette log10(2) ≈ 0.301", () => {
    expect(compareNumeric(expected, "0.301").equal).toBe(false);
  });
});

describe("compareNumeric — tolérance relative", () => {
  it("accepte dans 1% relatif", () => {
    const r = compareNumeric(
      { value: 100, tolerance: 0.01, relative: true },
      "100.5",
    );
    expect(r.equal).toBe(true);
  });

  it("rejette en dehors du 1% relatif", () => {
    const r = compareNumeric(
      { value: 100, tolerance: 0.01, relative: true },
      "102",
    );
    expect(r.equal).toBe(false);
  });
});

describe("compareNumeric — cas limites", () => {
  it("sqrt(2) ≈ 1.4142…", () => {
    const r = compareNumeric(
      { value: Math.SQRT2, tolerance: 1e-9, relative: false },
      "sqrt(2)",
    );
    expect(r.equal).toBe(true);
  });

  it("fraction 1/4 = 0.25", () => {
    const r = compareNumeric({ value: 0.25, tolerance: 1e-12, relative: false }, "1/4");
    expect(r.equal).toBe(true);
  });

  it("valeur non finie Infinity est refusée si attendu 2", () => {
    const r = compareNumeric({ value: 2, tolerance: 0, relative: false }, "Infinity");
    expect(r.equal).toBe(false);
  });
});

/**
 * `parseNumericSafe` était un analyseur écrit à la main, avec une liste de cas
 * particuliers codés en dur (`log(2)`, `log(3)`, `log(5)`…). Toute réponse
 * numérique écrite comme une expression — une fraction, un produit, une racine
 * composée — était déclarée non convertible et comptée fausse, alors que la
 * normalisation produit déjà une chaîne que mathjs sait évaluer.
 */
describe("compareNumeric — réponses écrites comme expressions", () => {
  const deux = { value: 2, tolerance: 1e-9, relative: false };

  it("évalue une fraction, y compris écrite par le champ mathématique", () => {
    expect(compareNumeric(deux, "4/2").equal).toBe(true);
    expect(compareNumeric(deux, "\\frac42").equal).toBe(true);
  });

  it("évalue un produit et une somme", () => {
    expect(compareNumeric(deux, "1+1").equal).toBe(true);
    expect(compareNumeric(deux, "2*1").equal).toBe(true);
    expect(compareNumeric(deux, "2\\cdot1").equal).toBe(true);
  });

  it("évalue une expression composée que la liste codée en dur ignorait", () => {
    expect(compareNumeric({ value: Math.log(4), tolerance: 1e-9, relative: false }, "2*ln(2)").equal).toBe(true);
    expect(compareNumeric({ value: 2 * Math.SQRT2, tolerance: 1e-9, relative: false }, "2*sqrt(2)").equal).toBe(true);
    expect(compareNumeric({ value: Math.PI / 2, tolerance: 1e-9, relative: false }, "pi/2").equal).toBe(true);
  });

  it("garde les constantes usuelles", () => {
    expect(compareNumeric({ value: Math.PI, tolerance: 1e-9, relative: false }, "pi").equal).toBe(true);
    expect(compareNumeric({ value: Math.LN2, tolerance: 1e-9, relative: false }, "ln(2)").equal).toBe(true);
  });

  it("refuse toujours une valeur fausse", () => {
    expect(compareNumeric(deux, "3").equal).toBe(false);
    expect(compareNumeric(deux, "5/2").equal).toBe(false);
    expect(compareNumeric(deux, "bonjour").equal).toBe(false);
  });
});

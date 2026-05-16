import { describe, it, expect } from "vitest";
import { compareFraction, applyFractionPenalty } from "../compare-fraction";

/**
 * Q15 : probabilité = 17/32 (fraction irréductible requise)
 */

describe("compareFraction — Q15 : 17/32", () => {
  const expected = { numerator: 17, denominator: 32, reduced: true };

  it("accepte '17/32' (fraction correcte, plein score)", () => {
    const r = compareFraction(expected, "17/32");
    expect(r.equal).toBe(true);
    expect(r.penalty).toBe(0);
  });

  it("accepte '34/64' avec pénalité 25% (équivalente, non réduite)", () => {
    const r = compareFraction(expected, "34/64");
    expect(r.equal).toBe(true);
    expect(r.penalty).toBe(0.25);
  });

  it("accepte '0.53125' avec pénalité 25% (décimal exact)", () => {
    const r = compareFraction(expected, "0.53125");
    expect(r.equal).toBe(true);
    expect(r.penalty).toBe(0.25);
  });

  it("accepte '0,53125' avec pénalité 25% (virgule décimale FR)", () => {
    const r = compareFraction(expected, "0,53125");
    expect(r.equal).toBe(true);
    expect(r.penalty).toBe(0.25);
  });

  it("accepte '51/96' avec pénalité 25% (équivalente = 17/32, non réduite)", () => {
    const r = compareFraction(expected, "51/96");
    expect(r.equal).toBe(true);
    expect(r.penalty).toBe(0.25);
  });

  it("rejette '1/2' (valeur incorrecte)", () => {
    const r = compareFraction(expected, "1/2");
    expect(r.equal).toBe(false);
  });

  it("rejette '0.5' (valeur incorrecte)", () => {
    const r = compareFraction(expected, "0.5");
    expect(r.equal).toBe(false);
  });

  it("rejette 'xyz' (format non reconnu)", () => {
    const r = compareFraction(expected, "xyz");
    expect(r.equal).toBe(false);
  });

  it("rejette division par zéro 17/0", () => {
    const r = compareFraction(expected, "17/0");
    expect(r.equal).toBe(false);
  });
});

describe("compareFraction — fractions non réductibles (reduced: false)", () => {
  const expected = { numerator: 1, denominator: 2, reduced: false };

  it("accepte 2/4 sans pénalité si reduced=false", () => {
    const r = compareFraction(expected, "2/4");
    expect(r.equal).toBe(true);
    expect(r.penalty).toBe(0);
  });
});

describe("applyFractionPenalty", () => {
  it("pénalité 0 → score plein", () => {
    expect(applyFractionPenalty(2, 0)).toBe(2);
  });

  it("pénalité 0.25 sur 2 pts → 1.5 pts", () => {
    expect(applyFractionPenalty(2, 0.25)).toBe(1.5);
  });

  it("pénalité 0.25 sur 4 pts → 3 pts", () => {
    expect(applyFractionPenalty(4, 0.25)).toBe(3);
  });
});

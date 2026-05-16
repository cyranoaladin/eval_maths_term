import { describe, it, expect } from "vitest";
import { areSymbolicallyEqual } from "../compare-symbolic";

/**
 * Tests pour les 5 variantes des questions RC du brief (critère §VIII.5).
 */

describe("compare-symbolic — Q12 : f'(x) = 2*exp(2*x) - 3", () => {
  const canonical = "2*exp(2*x) - 3";
  const vars = ["x"];

  const correctForms = [
    "2*exp(2*x)-3",
    "2exp(2x)-3",
    "2e^(2x)-3",
    "-3+2exp(2x)",
    "2 exp(2x) - 3",
  ];

  for (const form of correctForms) {
    it(`accepte "${form}"`, async () => {
      const result = await areSymbolicallyEqual(canonical, form, vars);
      expect(result.equal).toBe(true);
    });
  }

  const wrongForms = [
    "exp(2*x) - 3",         // coefficient manquant
    "2*exp(x) - 3",         // mauvais exposant
    "2*exp(2*x) + 3",       // signe inversé
    "4*exp(2*x) - 3",       // coefficient doublé
  ];

  for (const form of wrongForms) {
    it(`rejette "${form}"`, async () => {
      const result = await areSymbolicallyEqual(canonical, form, vars);
      expect(result.equal).toBe(false);
    });
  }
});

describe("compare-symbolic — Q13 : ln(2)", () => {
  const canonical = "log(2)"; // mathjs : log = ln naturel
  const vars: string[] = [];

  const correctForms = [
    "ln(2)",
    "\\ln(2)",
    "log(2)",
    "ln2",
    "\\ln 2",
  ];

  for (const form of correctForms) {
    it(`accepte "${form}"`, async () => {
      const result = await areSymbolicallyEqual(canonical, form, vars);
      expect(result.equal).toBe(true);
    });
  }

  it("rejette log10(2) (log base 10)", async () => {
    const result = await areSymbolicallyEqual(canonical, "log10(2)", vars);
    expect(result.equal).toBe(false);
  });
});

describe("compare-symbolic — Q14 : 2 - exp(-2*x)", () => {
  const canonical = "2 - exp(-2*x)";
  const vars = ["x"];

  const correctForms = [
    "2-exp(-2*x)",
    "2-e^(-2x)",
    "-exp(-2x)+2",
    "2 - e^{-2x}",
    "2-e^(-2*x)",
  ];

  for (const form of correctForms) {
    it(`accepte "${form}"`, async () => {
      const result = await areSymbolicallyEqual(canonical, form, vars);
      expect(result.equal).toBe(true);
    });
  }

  it("rejette 2 + exp(-2*x) (signe inversé)", async () => {
    const result = await areSymbolicallyEqual(canonical, "2+exp(-2*x)", vars);
    expect(result.equal).toBe(false);
  });

  it("rejette exp(-2*x) (terme constant manquant)", async () => {
    const result = await areSymbolicallyEqual(canonical, "exp(-2*x)", vars);
    expect(result.equal).toBe(false);
  });
});

describe("compare-symbolic — cas limites", () => {
  it("expression trop longue (> 200 chars) → refusée", async () => {
    const tooLong = "x+".repeat(110); // > 200 chars
    const result = await areSymbolicallyEqual("x", tooLong, ["x"]);
    expect(result.equal).toBe(false);
    expect(result.strategy).toBe("failed");
  });

  it("expression vide → refusée", async () => {
    const result = await areSymbolicallyEqual("2", "", []);
    expect(result.equal).toBe(false);
  });

  it("égalité littérale → stratégie literal", async () => {
    const result = await areSymbolicallyEqual("2*x+1", "2*x+1", ["x"]);
    expect(result.equal).toBe(true);
    expect(result.strategy).toBe("literal");
  });

  it("x + x ≡ 2*x → stratégie simplify ou numeric", async () => {
    const result = await areSymbolicallyEqual("2*x", "x+x", ["x"]);
    expect(result.equal).toBe(true);
  });

  it("x^2 ≠ x^3", async () => {
    const result = await areSymbolicallyEqual("x^2", "x^3", ["x"]);
    expect(result.equal).toBe(false);
  });
});

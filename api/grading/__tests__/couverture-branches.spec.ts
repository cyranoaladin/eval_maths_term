/**
 * Les dernières branches de correction encore jamais empruntées.
 *
 * Elles ne sont pas exotiques : une réponse qui vaut l'infini, un ensemble
 * écrit avec des crochets vides, une fonction qui produit une valeur
 * indéterminée en un point d'échantillonnage. Chacune décide d'une note.
 */
import { describe, it, expect } from "vitest";
import { compareNumeric } from "../compare-numeric";
import { compareSet } from "../compare-set";
import { areSymbolicallyEqual } from "../compare-symbolic";
import { buildGradingPrompt } from "../grading-prompt";
import { gradeResponse } from "../grade-response";
import type { GradingRubric } from "@contracts/grading-rubric";

describe("compareNumeric — dernières formes reconnues", () => {
  it("reconnaît un logarithme écrit comme un produit", () => {
    // « 2 ln 2 » et « ln 4 » sont la même valeur : l'élève a le droit de
    // s'arrêter à la première forme.
    expect(
      compareNumeric({ value: Math.log(4), tolerance: 1e-9, relative: false }, "2*ln(2)").equal,
    ).toBe(true);
  });

  it("refuse une fraction de dénominateur nul", () => {
    const r = compareNumeric({ value: 2, tolerance: 1e-9, relative: false }, "1/0");
    expect(r.equal).toBe(false);
  });

  it("reconnaît une racine carrée écrite avec une décimale", () => {
    expect(
      compareNumeric({ value: Math.sqrt(2.25), tolerance: 1e-9, relative: false }, "sqrt(2.25)").equal,
    ).toBe(true);
  });
});

describe("compareSet — écritures limites", () => {
  it("traite des délimiteurs sans contenu comme un ensemble vide", () => {
    expect(compareSet({ values: [], ordered: false }, "[]").equal).toBe(true);
    expect(compareSet({ values: [], ordered: false }, "( )").equal).toBe(true);
  });

  it("signale un élément en trop sans élément manquant", () => {
    const r = compareSet({ values: ["1"], ordered: false }, "{1, 2}");
    expect(r.equal).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual(["2"]);
    expect(r.reason).toMatch(/en trop/);
    expect(r.reason).not.toMatch(/manquants/);
  });

  it("signale un élément manquant sans élément en trop", () => {
    const r = compareSet({ values: ["1", "2"], ordered: false }, "{1}");
    expect(r.missing).toEqual(["2"]);
    expect(r.extra).toEqual([]);
    expect(r.reason).toMatch(/manquants/);
    expect(r.reason).not.toMatch(/en trop/);
  });

  it("ne confond pas une valeur infinie avec un nombre", () => {
    // `1/0` s'évalue mais ne vaut aucun nombre : le secours numérique doit
    // s'abstenir et laisser la comparaison littérale décider.
    const r = compareSet({ values: ["2"], ordered: false }, "{1/0}");
    expect(r.equal).toBe(false);
  });
});

describe("areSymbolicallyEqual — évaluations impossibles", () => {
  it("refuse quand l'évaluation produit une valeur indéterminée", async () => {
    // `0/0` est indéterminé : on ne peut rien conclure, donc on ne conclut pas.
    const r = await areSymbolicallyEqual("0/0", "x", ["x"]);
    expect(r.equal).toBe(false);
    expect(r.strategy).toBe("failed");
  });

  it("refuse quand l'évaluation sort du domaine réel", async () => {
    const r = await areSymbolicallyEqual("sqrt(x-1000)", "1", ["x"]);
    expect(r.equal).toBe(false);
    expect(r.reason).toMatch(/non scalaire/);
  });

  // La simplification symbolique de mathjs est réellement coûteuse sur des
  // expressions transcendantes : sous instrumentation de couverture, ce cas
  // dépasse le délai par défaut. Le délai est allongé plutôt que le test
  // affaibli.
  it("n'accorde aucun point à une réponse qui vaut l'infini", { timeout: 30_000 }, async () => {
    // La tolérance était calculée relativement à la plus grande des deux
    // valeurs : infinie face à un infini, elle rendait la comparaison
    // toujours vraie. « 1/0 » valait n'importe quelle réponse attendue.
    for (const attendu of ["2*x", "exp(x)"]) {
      const r = await areSymbolicallyEqual(attendu, "1/0", ["x"]);
      expect(r.equal, `« 1/0 » accepté pour « ${attendu} »`).toBe(false);
    }
    expect((await areSymbolicallyEqual("2", "1/0", [])).equal).toBe(false);
    expect((await areSymbolicallyEqual("2*x", "x/0", ["x"])).equal).toBe(false);
  });

  it("tolère un unique désaccord numérique", async () => {
    // Le test numérique échantillonne vingt points entre 0,64 et 3,44. Un
    // désaccord isolé peut venir d'une singularité de l'évaluation, pas d'une
    // erreur de l'élève : il est toléré, deux ne le sont pas. Un seul point
    // dépasse 3,3, donc la différence n'existe qu'en celui-là.
    const r = await areSymbolicallyEqual("x", "x+(sign(x-3.3)+1)/2", ["x"]);
    expect(r.equal).toBe(true);
    expect(r.reason).toMatch(/1 désaccord toléré/);
  });

  it("refuse deux désaccords", async () => {
    // Deux points dépassent 3,15 : le second désaccord ferme la porte.
    const r = await areSymbolicallyEqual("x", "x+(sign(x-3.15)+1)/2", ["x"]);
    expect(r.equal).toBe(false);
  });

  it("accepte deux expressions qui divergent identiquement", async () => {
    // Une limite peut légitimement valoir l'infini : c'est la divergence
    // *différente* qui est fausse, pas la divergence.
    const r = await areSymbolicallyEqual("1/0", "2/0", []);
    expect(r.equal).toBe(true);
  });

  it("refuse une réponse démesurée sans tenter de l'évaluer", () => {
    // Garde-fou : une expression de plus de deux cents caractères est un
    // vecteur de déni de service, pas une réponse d'élève.
    const enorme = "1+".repeat(150) + "1";
    return areSymbolicallyEqual("2", enorme, []).then((r) => {
      expect(r.equal).toBe(false);
      expect(r.reason).toMatch(/trop longue/);
    });
  });
});

describe("buildGradingPrompt — accord du barème", () => {
  const base = {
    question: "Question",
    expectedAnswer: "2",
    studentAnswer: "2",
    questionType: "short_answer" as const,
    detailedRubric: "Valeur exacte.",
  };

  it("accorde « point » au singulier", () => {
    const p = buildGradingPrompt({ ...base, maxPoints: 1 }).map((m) => m.content).join("\n");
    expect(p).toMatch(/1 point\b/);
    expect(p).not.toMatch(/1 points/);
  });

  it("accorde « points » au pluriel", () => {
    const p = buildGradingPrompt({ ...base, maxPoints: 3 }).map((m) => m.content).join("\n");
    expect(p).toMatch(/3 points/);
  });
});

describe("gradeResponse — type de question inattendu", () => {
  it("refuse de noter un type qu'il ne connaît pas", async () => {
    // Une donnée corrompue ne doit pas produire une note silencieuse.
    const r = await gradeResponse({
      questionType: "dissertation" as unknown as "short_answer",
      studentAnswer: "quelque chose",
      rubric: { mode: { kind: "exact" }, llmReviewRequired: false, weight: 1 } as GradingRubric,
      questionText: "Question",
      maxPoints: 2,
    });
    expect(r.score).toBe(0);
    expect(r.gradingMode).toBe("unknown");
    expect(r.feedback).toMatch(/type de question inconnu/i);
  });
});

/**
 * Ensembles solutions saisis dans le champ mathématique.
 *
 * MathLive écrit les accolades d'un ensemble sous forme de délimiteurs
 * extensibles échappés : `\left\{1,2\right\}`. Le découpage ne reconnaissait
 * que les accolades nues, et rendait « {\left\{1 », « 2\right\}` » — deux
 * éléments qui ne correspondaient à rien. Un élève ayant donné le bon ensemble
 * était compté faux.
 */
import { describe, it, expect } from "vitest";
import { compareSet } from "../compare-set";

const attendu = { values: ["1", "2"], ordered: false };

describe("compareSet — saisies élève", () => {
  it("accepte les accolades ordinaires", () => {
    expect(compareSet(attendu, "{1, 2}").equal).toBe(true);
    expect(compareSet(attendu, "1;2").equal).toBe(true);
  });

  it("accepte les délimiteurs extensibles de MathLive", () => {
    expect(compareSet(attendu, "\\left\\{1,2\\right\\}").equal).toBe(true);
    expect(compareSet(attendu, "\\{1;2\\}").equal).toBe(true);
  });

  it("accepte un ensemble de fractions écrites au clavier mathématique", () => {
    const demiEtTiers = { values: ["1/2", "1/3"], ordered: false };
    expect(compareSet(demiEtTiers, "\\left\\{\\frac12,\\frac13\\right\\}").equal).toBe(true);
  });

  it("reconnaît l'ensemble vide dans ses écritures usuelles", () => {
    const vide = { values: [], ordered: false };
    expect(compareSet(vide, "∅").equal).toBe(true);
    expect(compareSet(vide, "\\emptyset").equal).toBe(true);
    expect(compareSet(vide, "\\varnothing").equal).toBe(true);
    expect(compareSet(vide, "\\left\\{\\right\\}").equal).toBe(true);
  });

  it("refuse toujours un ensemble faux", () => {
    expect(compareSet(attendu, "\\left\\{1,3\\right\\}").equal).toBe(false);
    expect(compareSet(attendu, "\\left\\{1\\right\\}").equal).toBe(false);
  });

  it("distingue l'ordre quand il est exigé", () => {
    const ordonne = { values: ["1", "2"], ordered: true };
    expect(compareSet(ordonne, "\\left\\{1,2\\right\\}").equal).toBe(true);
    expect(compareSet(ordonne, "\\left\\{2,1\\right\\}").equal).toBe(false);
  });
});

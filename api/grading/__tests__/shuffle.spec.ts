import { describe, it, expect } from "vitest";
import {
  shuffleDeterministic,
  shuffleOptions,
  resolveOriginalIndex,
  seedFromString,
} from "../shuffle";

describe("shuffleDeterministic — déterminisme", () => {
  it("produit deux fois la même permutation avec le même seed", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const r1 = shuffleDeterministic(items, "same-seed");
    const r2 = shuffleDeterministic(items, "same-seed");
    expect(r1).toEqual(r2);
  });

  it("produit des permutations différentes avec des seeds différents", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const r1 = shuffleDeterministic(items, "seed-A");
    const r2 = shuffleDeterministic(items, "seed-B");
    expect(r1).not.toEqual(r2);
  });

  it("ne modifie pas le tableau original", () => {
    const original = [1, 2, 3, 4, 5];
    const copy = [...original];
    shuffleDeterministic(original, "test");
    expect(original).toEqual(copy);
  });

  it("préserve tous les éléments (bijectif)", () => {
    const items = [10, 20, 30, 40, 50];
    const result = shuffleDeterministic(items, "bijection-test");
    expect(result.sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50]);
  });

  it("tableau d'un seul élément reste inchangé", () => {
    expect(shuffleDeterministic(["a"], "seed")).toEqual(["a"]);
  });

  it("tableau vide reste vide", () => {
    expect(shuffleDeterministic([], "seed")).toEqual([]);
  });
});

describe("shuffleDeterministic — distribution uniforme sur 1000 seeds", () => {
  it("chaque position reçoit chaque élément avec fréquence ≈ 1/4 (±15%)", () => {
    const items = [0, 1, 2, 3];
    const N = 1000;
    // count[pos][val] = nombre de fois que val apparaît en position pos
    const count: number[][] = Array.from({ length: 4 }, () => [0, 0, 0, 0]);

    for (let s = 0; s < N; s++) {
      const result = shuffleDeterministic(items, `seed-${s}`);
      result.forEach((val, pos) => {
        count[pos][val]++;
      });
    }

    const expected = N / 4;
    const tolerance = expected * 0.15; // ±15%
    for (let pos = 0; pos < 4; pos++) {
      for (let val = 0; val < 4; val++) {
        expect(count[pos][val]).toBeGreaterThan(expected - tolerance);
        expect(count[pos][val]).toBeLessThan(expected + tolerance);
      }
    }
  });
});

describe("shuffleOptions — QCM correctIndex tracking", () => {
  it("le correctIndex original est retrouvé via mapping", () => {
    const options = ["A", "B", "C", "D"];
    const { correctIndex, mapping } = shuffleOptions(options, 2, "session123", 5);
    // Le bon index dans la vue mélangée doit mapper vers l'original 2
    expect(mapping[correctIndex]).toBe(2);
  });

  it("les options mélangées contiennent tous les choix", () => {
    const options = ["A", "B", "C", "D"];
    const { options: shuffled } = shuffleOptions(options, 0, "seed-q", 1);
    expect(shuffled.sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("seeds de session différentes → mélanges différents pour la même question", () => {
    const options = ["A", "B", "C", "D"];
    const r1 = shuffleOptions(options, 0, "session-A", 3);
    const r2 = shuffleOptions(options, 0, "session-B", 3);
    // Il peut y avoir une coïncidence, mais très improbable sur 4! = 24 permutations
    expect(r1.options).not.toEqual(r2.options);
  });

  it("déterministe : même seed + même question → même résultat", () => {
    const options = ["A", "B", "C", "D"];
    const r1 = shuffleOptions(options, 1, "stable-seed", 7);
    const r2 = shuffleOptions(options, 1, "stable-seed", 7);
    expect(r1.options).toEqual(r2.options);
    expect(r1.correctIndex).toBe(r2.correctIndex);
    expect(r1.mapping).toEqual(r2.mapping);
  });
});

describe("resolveOriginalIndex", () => {
  it("convertit l'index soumis en index original", () => {
    const options = ["A", "B", "C", "D"];
    const { correctIndex, mapping } = shuffleOptions(options, 2, "test-seed", 1);
    const resolved = resolveOriginalIndex(correctIndex, mapping);
    expect(resolved).toBe(2);
  });

  it("lève une erreur si index hors limites", () => {
    expect(() => resolveOriginalIndex(5, [0, 1, 2, 3])).toThrow();
    expect(() => resolveOriginalIndex(-1, [0, 1, 2, 3])).toThrow();
  });
});

describe("seedFromString", () => {
  it("retourne un entier non signé 32 bits", () => {
    const s = seedFromString("hello");
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(4294967295);
  });

  it("même chaîne → même graine", () => {
    expect(seedFromString("abc")).toBe(seedFromString("abc"));
  });

  it("chaînes différentes → graines différentes", () => {
    expect(seedFromString("abc")).not.toBe(seedFromString("abd"));
  });
});

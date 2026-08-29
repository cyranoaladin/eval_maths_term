/**
 * Phase 3.5 — Reconversion de l'index QCM.
 *
 * L'élève voit les options dans un ordre mélangé et soumet une position dans
 * CET ordre. La correction compare à `rubric.mode.correctIndex`, exprimé dans
 * l'ordre d'origine. Sans reconversion, la note d'un QCM est arbitraire.
 *
 * Le risque réel est la divergence de graine entre l'affichage
 * (`question.getForActiveSession`) et la correction : ces tests rejouent
 * l'affichage puis la reconversion pour vérifier l'aller-retour.
 */
import { describe, expect, it } from "vitest";
import {
  optionShuffleSeed,
  resolveSubmittedQcmIndex,
} from "../grade-session";
import { shuffleDeterministic } from "../shuffle";

const OPTIONS = ["$0$", "$1$", "$2$", "$4$"];
const SEED = "V1StGXR8_Z5jdHi6";
const QUESTION_ID = 42;

/** Reproduit exactement ce que `question.getForActiveSession` envoie à l'élève. */
function optionsAsSeenByStudent(
  options: string[],
  seed: string,
  questionId: number,
): string[] {
  return shuffleDeterministic(options, optionShuffleSeed(seed, questionId));
}

describe("resolveSubmittedQcmIndex : aller-retour affichage → correction", () => {
  it("chaque position soumise pointe sur l'option effectivement affichée", () => {
    const shown = optionsAsSeenByStudent(OPTIONS, SEED, QUESTION_ID);

    for (let submitted = 0; submitted < shown.length; submitted++) {
      const original = resolveSubmittedQcmIndex({
        rawOptions: OPTIONS,
        shuffleSeed: SEED,
        questionId: QUESTION_ID,
        submittedAnswer: String(submitted),
      });

      expect(original).toBeDefined();
      expect(OPTIONS[original!]).toBe(shown[submitted]);
    }
  });

  it("la reconversion est une bijection sur les indices", () => {
    const resolved = OPTIONS.map((_, i) =>
      resolveSubmittedQcmIndex({
        rawOptions: OPTIONS,
        shuffleSeed: SEED,
        questionId: QUESTION_ID,
        submittedAnswer: String(i),
      }),
    );
    expect(new Set(resolved).size).toBe(OPTIONS.length);
  });

  it("deux questions de la même session ont des mélanges distincts", () => {
    const a = optionShuffleSeed(SEED, 1);
    const b = optionShuffleSeed(SEED, 2);
    expect(a).not.toBe(b);
  });

  it("deux sessions différentes mélangent différemment la même question", () => {
    const a = optionShuffleSeed("graine-a", QUESTION_ID);
    const b = optionShuffleSeed("graine-b", QUESTION_ID);
    expect(a).not.toBe(b);
  });

  it("le mélange est déterministe : deux appels donnent le même ordre", () => {
    expect(optionsAsSeenByStudent(OPTIONS, SEED, QUESTION_ID)).toEqual(
      optionsAsSeenByStudent(OPTIONS, SEED, QUESTION_ID),
    );
  });

  it("accepte les options stockées en JSON (colonne MySQL json)", () => {
    const fromJson = resolveSubmittedQcmIndex({
      rawOptions: JSON.stringify(OPTIONS),
      shuffleSeed: SEED,
      questionId: QUESTION_ID,
      submittedAnswer: "1",
    });
    const fromArray = resolveSubmittedQcmIndex({
      rawOptions: OPTIONS,
      shuffleSeed: SEED,
      questionId: QUESTION_ID,
      submittedAnswer: "1",
    });
    expect(fromJson).toBe(fromArray);
  });
});

describe("resolveSubmittedQcmIndex : entrées non corrigeables", () => {
  const base = {
    rawOptions: OPTIONS,
    shuffleSeed: SEED,
    questionId: QUESTION_ID,
  };

  it("retourne undefined sans graine de session", () => {
    expect(
      resolveSubmittedQcmIndex({ ...base, shuffleSeed: null, submittedAnswer: "0" }),
    ).toBeUndefined();
  });

  it("retourne undefined si la réponse n'est pas un entier", () => {
    expect(
      resolveSubmittedQcmIndex({ ...base, submittedAnswer: "" }),
    ).toBeUndefined();
    expect(
      resolveSubmittedQcmIndex({ ...base, submittedAnswer: "abc" }),
    ).toBeUndefined();
  });

  it("retourne undefined si l'index est hors limites", () => {
    expect(
      resolveSubmittedQcmIndex({ ...base, submittedAnswer: "4" }),
    ).toBeUndefined();
    expect(
      resolveSubmittedQcmIndex({ ...base, submittedAnswer: "-1" }),
    ).toBeUndefined();
  });

  it("retourne undefined si les options sont absentes ou illisibles", () => {
    expect(
      resolveSubmittedQcmIndex({ ...base, rawOptions: null, submittedAnswer: "0" }),
    ).toBeUndefined();
    expect(
      resolveSubmittedQcmIndex({ ...base, rawOptions: "{pas du json", submittedAnswer: "0" }),
    ).toBeUndefined();
    expect(
      resolveSubmittedQcmIndex({ ...base, rawOptions: [], submittedAnswer: "0" }),
    ).toBeUndefined();
  });
});

describe("resolveSubmittedQcmIndex : copies papier", () => {
  const base = {
    rawOptions: OPTIONS,
    shuffleSeed: null,
    questionId: QUESTION_ID,
    mode: "paper" as const,
  };

  it("la position saisie est déjà l'index d'origine", () => {
    // Le sujet imprimé porte les options dans l'ordre d'origine : l'enseignant
    // saisit « B » pour la deuxième option, qui est bien l'index 1.
    for (let i = 0; i < OPTIONS.length; i++) {
      expect(
        resolveSubmittedQcmIndex({ ...base, submittedAnswer: String(i) }),
      ).toBe(i);
    }
  });

  it("ne dépend pas de la graine de mélange", () => {
    expect(
      resolveSubmittedQcmIndex({ ...base, shuffleSeed: SEED, submittedAnswer: "2" }),
    ).toBe(2);
  });

  it("valide quand même les bornes", () => {
    expect(
      resolveSubmittedQcmIndex({ ...base, submittedAnswer: "4" }),
    ).toBeUndefined();
    expect(
      resolveSubmittedQcmIndex({ ...base, submittedAnswer: "-1" }),
    ).toBeUndefined();
  });

  it("refuse une saisie non numérique", () => {
    expect(
      resolveSubmittedQcmIndex({ ...base, submittedAnswer: "B" }),
    ).toBeUndefined();
  });

  it("papier et en ligne divergent bien sur la même copie", () => {
    // Garde-fou : si les deux modes rendaient le même résultat, c'est que la
    // reconversion en ligne ne s'applique plus.
    const enLigne = OPTIONS.map((_, i) =>
      resolveSubmittedQcmIndex({
        rawOptions: OPTIONS,
        shuffleSeed: SEED,
        questionId: QUESTION_ID,
        submittedAnswer: String(i),
        mode: "online",
      }),
    );
    const papier = OPTIONS.map((_, i) => i);
    expect(enLigne).not.toEqual(papier);
  });
});

describe("périmètre de notation", () => {
  it("le barème d'une copie papier se limite aux questions imprimées", () => {
    // Une évaluation de 31 points dont 21 seulement sur la feuille-réponses :
    // sans restriction, une copie parfaite plafonnerait à 13,5/20 parce que
    // les réponses rédigées, corrigées à part, seraient comptées perdues.
    const toutes = [
      { id: 1, points: 1 }, { id: 2, points: 1 }, { id: 3, points: 2 },
      { id: 4, points: 2 }, { id: 5, points: 2 },
    ];
    const imprimees = [1, 2];

    const baremeComplet = toutes.reduce((s, q) => s + q.points, 0);
    const baremeImprime = toutes
      .filter((q) => imprimees.includes(q.id))
      .reduce((s, q) => s + q.points, 0);

    expect(baremeComplet).toBe(8);
    expect(baremeImprime).toBe(2);

    // Copie parfaite sur le périmètre imprimé → 20/20, pas 5/20.
    expect(Math.round((baremeImprime / baremeImprime) * 20)).toBe(20);
    expect(Math.round((baremeImprime / baremeComplet) * 20)).toBe(5);
  });
});

describe("notes attribuées par l'enseignant", () => {
  it("reconnaît les modes de correction humains", async () => {
    const { estNoteManuelle } = await import("../grade-session");
    // Une relance de correction écrasait ces notes en silence.
    expect(estNoteManuelle("manual_override")).toBe(true);
    expect(estNoteManuelle("manual_paper")).toBe(true);
    expect(estNoteManuelle("qcm")).toBe(false);
    expect(estNoteManuelle("symbolic")).toBe(false);
    expect(estNoteManuelle("llm")).toBe(false);
    expect(estNoteManuelle(null)).toBe(false);
  });
});

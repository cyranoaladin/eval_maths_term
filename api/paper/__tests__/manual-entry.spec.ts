/**
 * La conversion entre ce qui est coché sur le papier et ce qui est enregistré.
 *
 * L'enseignant saisit une lettre ; la correction attend une réponse. Un
 * décalage entre les deux fausserait toutes les notes d'un paquet de copies,
 * sans que rien ne le signale.
 */
import { describe, it, expect } from "vitest";
import { answerToChoice, choiceToAnswer } from "../manual-entry";

describe("choiceToAnswer", () => {
  it("rend l'index tel quel pour un QCM", () => {
    expect(choiceToAnswer("qcm", 0)).toBe("0");
    expect(choiceToAnswer("qcm", 3)).toBe("3");
  });

  it("traduit la première case en « vrai » et la seconde en « faux »", () => {
    expect(choiceToAnswer("true_false", 0)).toBe("true");
    expect(choiceToAnswer("true_false", 1)).toBe("false");
  });

  it("n'a rien à convertir pour une question rédigée", () => {
    // Une réponse courte se corrige à la main : il n'y a pas de case.
    expect(choiceToAnswer("short_answer", 0)).toBeNull();
  });
});

describe("answerToChoice", () => {
  it("retrouve la case d'un QCM déjà saisi", () => {
    expect(answerToChoice("qcm", "2")).toBe(2);
    expect(answerToChoice("qcm", "0")).toBe(0);
  });

  it("retrouve la case d'un vrai/faux", () => {
    expect(answerToChoice("true_false", "true")).toBe(0);
    expect(answerToChoice("true_false", "false")).toBe(1);
  });

  it("rend l'aller-retour fidèle", () => {
    // C'est l'invariant qui compte : réafficher une copie saisie doit montrer
    // exactement les cases cochées.
    for (const i of [0, 1, 2, 3]) {
      expect(answerToChoice("qcm", choiceToAnswer("qcm", i)!)).toBe(i);
    }
    for (const i of [0, 1]) {
      expect(answerToChoice("true_false", choiceToAnswer("true_false", i)!)).toBe(i);
    }
  });

  it("ne devine rien d'une réponse illisible", () => {
    expect(answerToChoice("qcm", "pas un nombre")).toBeNull();
    expect(answerToChoice("qcm", "")).toBeNull();
    expect(answerToChoice("qcm", "B")).toBeNull();
    expect(answerToChoice("true_false", "peut-être")).toBeNull();
    expect(answerToChoice("short_answer", "2x")).toBeNull();
  });

  it("n'envoie jamais un index brut au correcteur pour un vrai/faux", () => {
    // « 0 » n'est pas une valeur booléenne pour le moteur : la question serait
    // comptée fausse quelle que soit la réponse de l'élève.
    expect(choiceToAnswer("true_false", 0)).not.toBe("0");
    expect(choiceToAnswer("true_false", 1)).not.toBe("1");
  });
});

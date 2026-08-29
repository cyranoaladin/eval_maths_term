/**
 * Conversion des lettres de la feuille-réponses.
 *
 * L'enseignant lit « question 7 : B » sur le papier et le reporte. Cette
 * lettre doit devenir exactement ce que le moteur de correction attend, sans
 * quoi la copie est notée de travers en silence — le cas le plus dangereux,
 * parce que rien ne signale l'erreur.
 */
import { describe, expect, it } from "vitest";
import { answerToChoice, choiceToAnswer } from "../../paper/manual-entry";

describe("QCM", () => {
  it("la lettre devient directement l'index d'origine", () => {
    // Le tirage ne mélange rien : A vaut 0, B vaut 1, et ainsi de suite.
    expect(choiceToAnswer("qcm", 0)).toBe("0");
    expect(choiceToAnswer("qcm", 2)).toBe("2");
  });

  it("l'aller-retour est fidèle", () => {
    for (let i = 0; i < 6; i++) {
      expect(answerToChoice("qcm", choiceToAnswer("qcm", i)!)).toBe(i);
    }
  });
});

describe("Vrai / Faux", () => {
  it("A devient « true », B devient « false »", () => {
    // Le sujet imprime toujours Vrai puis Faux, dans cet ordre.
    expect(choiceToAnswer("true_false", 0)).toBe("true");
    expect(choiceToAnswer("true_false", 1)).toBe("false");
  });

  it("n'envoie jamais un index brut au correcteur", () => {
    // « 0 » n'est pas reconnu comme une valeur booléenne par gradeResponse :
    // la question serait comptée fausse quelle que soit la réponse de l'élève.
    expect(choiceToAnswer("true_false", 0)).not.toBe("0");
    expect(choiceToAnswer("true_false", 1)).not.toBe("1");
  });

  it("l'aller-retour est fidèle", () => {
    expect(answerToChoice("true_false", choiceToAnswer("true_false", 0)!)).toBe(0);
    expect(answerToChoice("true_false", choiceToAnswer("true_false", 1)!)).toBe(1);
  });
});

describe("questions non grillables", () => {
  it("une réponse courte n'a pas de lettre", () => {
    expect(choiceToAnswer("short_answer", 0)).toBeNull();
    expect(answerToChoice("short_answer", "1/2")).toBeNull();
  });
});

describe("relecture d'une copie déjà saisie", () => {
  it("ignore une réponse illisible plutôt que d'inventer une case", () => {
    expect(answerToChoice("qcm", "")).toBeNull();
    expect(answerToChoice("qcm", "B")).toBeNull();
    expect(answerToChoice("true_false", "peut-être")).toBeNull();
  });
});

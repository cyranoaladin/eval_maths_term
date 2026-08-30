/**
 * Le barème d'une question doit reconnaître la réponse que la question annonce.
 *
 * Une question porte deux descriptions de sa bonne réponse : celle qu'on montre
 * à l'enseignant, et la règle qui notera les copies. Le contrôle structurel les
 * liait pour les QCM et les vrai/faux, où la correspondance est littérale. Pour
 * une réponse courte, il vérifiait seulement que la fiche n'était pas vide :
 * on pouvait afficher « x = 2 » à côté d'un barème n'acceptant que « 2 », et
 * découvrir après l'épreuve que toute la classe avait faux.
 */
import { describe, it, expect } from "vitest";
import {
  assertBaremeCoherent,
  verifierQueLeBaremeReconnaitLaReponse,
} from "../coherence-bareme";
import { evaluationQuestions } from "@contracts/evaluation-data";
import { GradingRubricSchema } from "@contracts/grading-rubric";

describe("le barème reconnaît la réponse annoncée", () => {
  it("accepte une valeur numérique dans la tolérance", async () => {
    const v = await verifierQueLeBaremeReconnaitLaReponse({
      type: "short_answer",
      question: "Combien font 1 + 1 ?",
      correctAnswer: "2",
      points: 2,
      gradingRubric: {
        mode: { kind: "numeric", value: 2, tolerance: 0, relative: false },
        llmReviewRequired: false,
        weight: 2,
      },
    });
    expect(v.reconnue).toBe(true);
    expect(v.score).toBe(2);
  });

  it("refuse une fiche et un barème qui ne disent pas le même nombre", async () => {
    // Le cas réel : l'enseignant corrige le barème et oublie la fiche, ou
    // l'inverse. Rien ne le signalait, et l'écart ne se voyait qu'après
    // l'épreuve — sur les copies de toute la classe.
    await expect(
      assertBaremeCoherent({
        type: "short_answer",
        question: "Combien font 2 + 2 ?",
        correctAnswer: "4",
        points: 2,
        gradingRubric: {
          mode: { kind: "numeric", value: 5, tolerance: 0, relative: false },
          llmReviewRequired: false,
          weight: 2,
        },
      }),
    ).rejects.toThrow(/ne reconnaît pas la réponse annoncée/);
  });

  it("refuse une forme symbolique étrangère à la canonique", async () => {
    await expect(
      assertBaremeCoherent({
        type: "short_answer",
        question: "Dériver x².",
        correctAnswer: "x^2",
        points: 3,
        gradingRubric: {
          mode: { kind: "symbolic", canonical: "2*x", variables: ["x"] },
          llmReviewRequired: false,
          weight: 3,
        },
      }),
    ).rejects.toThrow(/ne reconnaît pas la réponse annoncée/);
  });

  it("accepte une forme explicitement déclarée acceptable", async () => {
    const v = await verifierQueLeBaremeReconnaitLaReponse({
      type: "short_answer",
      question: "Écrire la solution.",
      correctAnswer: "x = 2",
      points: 2,
      gradingRubric: {
        mode: { kind: "exact" },
        acceptableForms: ["x = 2", "x=2"],
        llmReviewRequired: false,
        weight: 2,
      },
    });
    expect(v.reconnue).toBe(true);
  });

  it("accepte une écriture symbolique équivalente à la forme canonique", async () => {
    const v = await verifierQueLeBaremeReconnaitLaReponse({
      type: "short_answer",
      question: "Dériver.",
      correctAnswer: "2\\cdot x",
      points: 3,
      gradingRubric: {
        mode: { kind: "symbolic", canonical: "2*x", variables: ["x"] },
        llmReviewRequired: false,
        weight: 3,
      },
    });
    expect(v.reconnue).toBe(true);
  });

  it("refuse un QCM dont la fiche désigne une autre proposition", async () => {
    await expect(
      assertBaremeCoherent({
        type: "qcm",
        question: "Laquelle ?",
        correctAnswer: "0",
        points: 1,
        gradingRubric: {
          mode: { kind: "qcm", correctIndex: 2 },
          llmReviewRequired: false,
          weight: 1,
        },
      }),
    ).rejects.toThrow(/ne reconnaît pas/);
  });

  it("refuse un vrai/faux dont la fiche dit l'inverse du barème", async () => {
    await expect(
      assertBaremeCoherent({
        type: "true_false",
        question: "La fonction est croissante.",
        correctAnswer: "true",
        points: 1,
        gradingRubric: {
          mode: { kind: "true_false", correctValue: "false" },
          llmReviewRequired: false,
          weight: 1,
        },
      }),
    ).rejects.toThrow(/ne reconnaît pas/);
  });

  it("ne tranche pas une question dont la correction demande le modèle", () => {
    // Un jugement rédactionnel ne se valide pas au moment de l'écriture, et un
    // appel réseau n'a rien à faire dans une écriture.
    return expect(
      verifierQueLeBaremeReconnaitLaReponse({
        type: "short_answer",
        question: "Justifier votre raisonnement.",
        correctAnswer: "Parce que la fonction est continue sur l'intervalle.",
        points: 3,
        gradingRubric: {
          mode: { kind: "exact" },
          acceptableForms: ["(rédaction libre)"],
          llmReviewRequired: true,
          weight: 3,
        },
      }),
    ).resolves.toMatchObject({ reconnue: true });
  });
});

describe("l'évaluation de référence", () => {
  it("annonce des réponses que ses propres barèmes reconnaissent", async () => {
    // Le semis écrit directement en base, sans passer par les routes : rien ne
    // le soumettrait au contrôle. C'est pourtant l'évaluation que tout le monde
    // voit en premier.
    const fautives: string[] = [];
    for (const q of evaluationQuestions) {
      if (!q.gradingRubric) {
        fautives.push(`Q${q.order} : aucun barème`);
        continue;
      }
      const rubric = GradingRubricSchema.safeParse(q.gradingRubric);
      if (!rubric.success) {
        fautives.push(`Q${q.order} : barème invalide`);
        continue;
      }
      const v = await verifierQueLeBaremeReconnaitLaReponse({
        type: q.type,
        question: q.question,
        correctAnswer: q.correctAnswer,
        points: q.points,
        gradingRubric: rubric.data,
      });
      if (!v.reconnue) {
        fautives.push(
          `Q${q.order} « ${q.correctAnswer} » → ${v.score}/${q.points} : ${v.raison}`,
        );
      }
    }
    expect(fautives, `\n${fautives.join("\n")}`).toEqual([]);
  }, 60_000);
});

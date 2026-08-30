/**
 * Retour diagnostique des QCM.
 *
 * Un distracteur n'a d'intérêt pédagogique que s'il nomme l'erreur commise.
 * L'enseignant documente l'erreur type par proposition ; l'élève la lit à la
 * place d'un « Réponse incorrecte » qui ne lui apprend rien.
 */
import { describe, expect, it } from "vitest";
import { gradeResponse } from "../grade-response";
import type { GradingRubric } from "@contracts/grading-rubric";

const RUBRIC: GradingRubric = {
  mode: { kind: "qcm", correctIndex: 2 },
  llmReviewRequired: false,
  weight: 1,
  distractorDiagnostics: [
    "Vous avez confondu $u_{n+1}=u_n+r$ et $u_n=u_0+nr$. Revoyez la fiche M3.",
    "", // pas de diagnostic pour celle-ci
    "", // la bonne réponse
    "Vous avez oublié la condition de convergence. Revoyez la méthode M5.",
  ],
};

const base = {
  questionType: "qcm" as const,
  studentAnswer: "",
  rubric: RUBRIC,
  questionText: "La suite converge vers :",
  maxPoints: 1,
};

describe("retour diagnostique des QCM", () => {
  it("la bonne réponse est validée sans diagnostic", async () => {
    const r = await gradeResponse({ ...base, resolvedQcmIndex: 2 });
    expect(r.isCorrect).toBe(true);
    expect(r.score).toBe(1);
    expect(r.feedback).toBe("Bonne réponse.");
  });

  it("un distracteur documenté renvoie son erreur type", async () => {
    const r = await gradeResponse({ ...base, resolvedQcmIndex: 0 });
    expect(r.isCorrect).toBe(false);
    expect(r.score).toBe(0);
    expect(r.feedback).toMatch(/confondu.*fiche M3/);
  });

  it("un autre distracteur renvoie son propre diagnostic", async () => {
    const r = await gradeResponse({ ...base, resolvedQcmIndex: 3 });
    expect(r.feedback).toMatch(/condition de convergence.*M5/);
  });

  it("un distracteur non documenté retombe sur le retour générique", async () => {
    const r = await gradeResponse({ ...base, resolvedQcmIndex: 1 });
    expect(r.feedback).toBe("Réponse incorrecte.");
  });

  it("une rubric sans diagnostics reste supportée", async () => {
    const r = await gradeResponse({
      ...base,
      rubric: { mode: { kind: "qcm", correctIndex: 2 }, llmReviewRequired: false, weight: 1 },
      resolvedQcmIndex: 0,
    });
    expect(r.feedback).toBe("Réponse incorrecte.");
    expect(r.score).toBe(0);
  });

  it("le diagnostic ne change jamais la note", async () => {
    const avec = await gradeResponse({ ...base, resolvedQcmIndex: 0 });
    const sans = await gradeResponse({
      ...base,
      rubric: { mode: { kind: "qcm", correctIndex: 2 }, llmReviewRequired: false, weight: 1 },
      resolvedQcmIndex: 0,
    });
    expect(avec.score).toBe(sans.score);
  });
});

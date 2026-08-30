/**
 * Ce que le moteur fait quand une réponse le met en échec.
 *
 * Une seule réponse qui fait échouer un comparateur ne doit pas emporter la
 * copie entière : les autres restent notées, la note déjà acquise sur celle-ci
 * est conservée, et l'enseignant est averti qu'il reste quelque chose à
 * regarder.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { responses, sessions } from "@db/schema";
import type { GradingRubric } from "@contracts/grading-rubric";

const etat: {
  sessions: Array<{ id: number; evaluationId: number; shuffleSeed: string; mode: string }>;
  questions: Array<Record<string, unknown>>;
  responses: Array<Record<string, unknown>>;
  misesAJour: Array<{ table: unknown; valeurs: Record<string, unknown> }>;
} = { sessions: [], questions: [], responses: [], misesAJour: [] };

function fauxDb() {
  const lignesDe = (table: unknown) =>
    table === sessions ? etat.sessions : table === responses ? etat.responses : etat.questions;
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const p = Promise.resolve(lignesDe(table));
          return Object.assign(p, { limit: () => p });
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (valeurs: Record<string, unknown>) => ({
        where: () => {
          etat.misesAJour.push({ table, valeurs });
          return Promise.resolve();
        },
      }),
    }),
    // Le moteur applique désormais ses écritures en une transaction : le double
    // doit l'offrir, sans quoi il ne représenterait plus la base.
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(fauxDb()),
  };
}

vi.mock("../../queries/connection", () => ({ getDb: () => fauxDb() }));

const comportement = vi.hoisted(() => ({
  echoue: false,
  confiance: null as number | null,
}));

vi.mock("../grade-response", () => ({
  gradeResponse: async ({ maxPoints }: { maxPoints: number }) => {
    if (comportement.echoue) throw new Error("comparateur en échec");
    return {
      score: maxPoints,
      maxPoints,
      isCorrect: true,
      feedback: "Correct.",
      gradingMode: "llm",
      llmConfidence: comportement.confiance,
      partialCreditApplied: false,
    };
  },
}));

const { gradeSessionResponses } = await import("../grade-session");

const barème: GradingRubric = {
  mode: { kind: "numeric", value: 2, tolerance: 1e-9, relative: false },
  llmReviewRequired: false,
  weight: 2,
};

beforeEach(() => {
  comportement.echoue = false;
  comportement.confiance = null;
  etat.sessions = [{ id: 1, evaluationId: 1, shuffleSeed: "graine", mode: "online" }];
  etat.questions = [
    { id: 10, evaluationId: 1, type: "short_answer", question: "Q1", options: null, points: 2, gradingRubric: barème, order: 1 },
    { id: 11, evaluationId: 1, type: "short_answer", question: "Q2", options: null, points: 2, gradingRubric: barème, order: 2 },
  ];
  etat.responses = [
    { id: 100, sessionId: 1, questionId: 10, answer: "2", justification: null, score: "1.25", gradingMode: null },
    { id: 101, sessionId: 1, questionId: 11, answer: "2", justification: null, score: null, gradingMode: null },
  ];
  etat.misesAJour = [];
});

describe("gradeSessionResponses — réponse en échec", () => {
  it("ne perd pas la copie entière", async () => {
    comportement.echoue = true;
    const r = await gradeSessionResponses(1);
    expect(r.needsManualReview).toBe(2);
    // La note déjà inscrite sur chaque réponse est conservée telle quelle.
    expect(r.totalScore).toBe(1.25);
  });

  it("signale à l'enseignant ce qui reste à regarder", async () => {
    comportement.echoue = true;
    const r = await gradeSessionResponses(1);
    expect(r.gradedCount).toBe(0);
    expect(r.needsManualReview).toBeGreaterThan(0);
  });

  it("écrit toute la copie en un seul ordre", async () => {
    await gradeSessionResponses(1);
    expect(etat.misesAJour.filter((m) => m.table === responses)).toHaveLength(1);
  });

  it("n'écrit rien sur les réponses quand aucune n'a pu être corrigée", async () => {
    // Les totaux de la session sont tout de même mis à jour : la copie existe,
    // elle vaut ce qu'elle valait.
    comportement.echoue = true;
    await gradeSessionResponses(1);
    expect(etat.misesAJour.filter((m) => m.table === responses)).toHaveLength(0);
    expect(etat.misesAJour.filter((m) => m.table === sessions)).toHaveLength(1);
  });
});

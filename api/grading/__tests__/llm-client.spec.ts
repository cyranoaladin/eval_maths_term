import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearLLMCache, isLLMCached } from "../llm-client";
import type { GradingPromptArgs } from "../grading-prompt";

/**
 * Tests du client LLM avec fetch mocké.
 * Vérifie : retry × 3, cache LRU, parsing JSON avec fences, clampage du score.
 */

const SAMPLE_ARGS: GradingPromptArgs = {
  question: "Calculez f'(x) pour f(x) = e^(2x) - 3x",
  expectedAnswer: "2*exp(2*x) - 3",
  studentAnswer: "2e^(2x)-3",
  questionType: "short_answer",
  maxPoints: 2,
  detailedRubric: "Accepte toute forme équivalente à 2exp(2x)-3.",
};

describe("gradeWithLLM — cache LRU", () => {
  beforeEach(() => {
    clearLLMCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deuxième appel identique utilise le cache (0 fetch)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ score: 2, feedback: "Correct.", confidence: 0.95 }) } }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    // Premier appel : fetch
    const { gradeWithLLM } = await import("../llm-client");
    const r1 = await gradeWithLLM(SAMPLE_ARGS);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Deuxième appel identique : cache
    const r2 = await gradeWithLLM(SAMPLE_ARGS);
    expect(mockFetch).toHaveBeenCalledTimes(1); // toujours 1
    expect(r2).toEqual(r1);
  });

  it("isLLMCached retourne true après un appel réussi", async () => {
    clearLLMCache();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ score: 1, feedback: "Ok.", confidence: 0.8 }) } }],
      }),
    }));
    const { gradeWithLLM } = await import("../llm-client");
    await gradeWithLLM(SAMPLE_ARGS);
    expect(isLLMCached(SAMPLE_ARGS)).toBe(true);
  });
});

describe("gradeWithLLM — retry × 3", () => {
  beforeEach(() => {
    clearLLMCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("réussit à la 3ème tentative après 2 échecs", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error("Réseau indisponible");
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ score: 2, feedback: "Bien.", confidence: 0.9 }) } }],
        }),
      };
    }));

    const { gradeWithLLM } = await import("../llm-client");

    // Lance l'appel et avance les timers pour les backoffs
    const promise = gradeWithLLM({ ...SAMPLE_ARGS, studentAnswer: "retry-test-unique" });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(calls).toBe(3);
    expect(result.score).toBe(2);
  });

});

describe("gradeWithLLM — tous les retries échouent", () => {
  beforeEach(() => {
    clearLLMCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("lève une erreur après 3 échecs (promise rejetée attendue)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("LLM down")));
    const { gradeWithLLM } = await import("../llm-client");
    // Capturer immédiatement la rejection pour éviter unhandled rejection
    const promise = gradeWithLLM({ ...SAMPLE_ARGS, studentAnswer: "fail-all-caught" });
    const captured = promise.then(() => "ok").catch((e: Error) => e.message);
    await vi.runAllTimersAsync();
    const msg = await captured;
    expect(msg).toContain("LLM down");
  });
});

describe("parseLLMResponse — parsing tolérant", () => {
  beforeEach(() => {
    clearLLMCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parse une réponse avec fences ```json```", async () => {
    const fencedJson = `\`\`\`json\n{"score":1.5,"feedback":"Bien.","confidence":0.85}\n\`\`\``;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: fencedJson } }] }),
    }));
    const { gradeWithLLM } = await import("../llm-client");
    const result = await gradeWithLLM({ ...SAMPLE_ARGS, studentAnswer: "fence-test" });
    expect(result.score).toBe(1.5);
  });

  it("parse une réponse avec fences ```sans json```", async () => {
    const fencedJson = `\`\`\`\n{"score":1,"feedback":"Ok.","confidence":0.7}\n\`\`\``;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: fencedJson } }] }),
    }));
    const { gradeWithLLM } = await import("../llm-client");
    const result = await gradeWithLLM({ ...SAMPLE_ARGS, studentAnswer: "fence-no-lang" });
    expect(result.score).toBe(1);
  });

  it("clamp le score au-delà du barème", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ score: 99, feedback: "Top.", confidence: 1 }) } }],
      }),
    }));
    const { gradeWithLLM } = await import("../llm-client");
    const result = await gradeWithLLM({ ...SAMPLE_ARGS, studentAnswer: "clamp-test", maxPoints: 2 });
    expect(result.score).toBe(2); // clampé
  });

  it("arrondi au demi-point", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ score: 1.3, feedback: "Presque.", confidence: 0.6 }) } }],
      }),
    }));
    const { gradeWithLLM } = await import("../llm-client");
    const result = await gradeWithLLM({ ...SAMPLE_ARGS, studentAnswer: "round-test" });
    expect(result.score).toBe(1.5); // 1.3 → arrondi à 1.5
  });
});

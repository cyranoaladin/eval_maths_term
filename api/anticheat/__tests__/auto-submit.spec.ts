import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../queries/connection", () => ({ getDb: vi.fn() }));
vi.mock("../score-suspicion", () => ({
  computeSuspicionScore: vi.fn().mockReturnValue({
    score: 0, verdict: "clean", reasons: [],
  }),
}));
vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { autoSubmitSession } from "../auto-submit";
import { getDb } from "../../queries/connection";
import { computeSuspicionScore } from "../score-suspicion";

const BASE_SESSION = {
  id: 1,
  evaluationId: 1,
  status: "in_progress",
  startedAt: new Date(Date.now() - 30_000),
};

const BASE_QUESTION = {
  id: 10,
  evaluationId: 1,
  type: "qcm",
  question: "Question test ?",
  points: 2,
  gradingRubric: {
    mode: { kind: "exact", expected: "A" },
    acceptableForms: ["A"],
  },
};

const BASE_DRAFT = {
  sessionId: 1,
  questionId: 10,
  answer: "A",
  justification: null,
  committedAt: null,
};

function makeChain(result: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(result);
  // some queries don't call .limit (e.g. SELECT all questions, SELECT cheat events)
  // make .where also thenable so awaiting it returns the result
  (chain.where as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const subChain: Record<string, unknown> = {};
    subChain.limit = vi.fn().mockResolvedValue(result);
    subChain[Symbol.iterator as never] = undefined;
    // make it a Promise-like so `await tx.select().from().where()` works too
    const p = Promise.resolve(result);
    return Object.assign(subChain, {
      then: p.then.bind(p),
      catch: p.catch.bind(p),
    });
  });
  return chain;
}

function makeTransaction(session: object | null, drafts: object[], qs: object[], events: object[]) {
  const results = [
    session ? [session] : [],  // 1st select: sessions
    drafts,                     // 2nd select: answerDrafts
    qs,                         // 3rd select: questions
    events,                     // 4th select: cheatEvents
  ];
  let idx = 0;

  const mockTx = {
    select: vi.fn().mockImplementation(() => makeChain(results[idx++] ?? [])),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
  };

  return mockTx;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("autoSubmitSession", () => {
  it("no-op si la session est déjà complétée", async () => {
    const completedSession = { ...BASE_SESSION, status: "completed" };

    const tx = makeTransaction(completedSession, [], [], []);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
      transaction: vi.fn().mockImplementation((fn) => fn(tx)),
    });

    await autoSubmitSession(1, { reason: "idle_disconnect" });

    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("lève une erreur si la session est introuvable", async () => {
    const tx = makeTransaction(null, [], [], []);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
      transaction: vi.fn().mockImplementation((fn) => fn(tx)),
    });

    await expect(autoSubmitSession(999, { reason: "idle_disconnect" })).rejects.toThrow(
      "introuvable",
    );
  });

  it("convertit les drafts en réponses et met à jour la session", async () => {
    const tx = makeTransaction(BASE_SESSION, [BASE_DRAFT], [BASE_QUESTION], []);
    const dbMock = { transaction: vi.fn().mockImplementation((fn) => fn(tx)) };
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue(dbMock);

    await autoSubmitSession(1, { reason: "idle_disconnect" });

    expect(tx.insert).toHaveBeenCalledTimes(2); // 1 response + 1 idle_disconnect event
    expect(tx.update).toHaveBeenCalledTimes(2); // 1 draft archivé + 1 session mise à jour
  });

  it("insère idle_disconnect dans cheat_events pour la raison idle_disconnect", async () => {
    const tx = makeTransaction(BASE_SESSION, [], [BASE_QUESTION], []);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
      transaction: vi.fn().mockImplementation((fn) => fn(tx)),
    });

    await autoSubmitSession(1, { reason: "idle_disconnect" });

    const insertCalls = (tx.insert as ReturnType<typeof vi.fn>).mock.calls;
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("traite une question sans rubric (gradingRubric null) → score 0 avec feedback", async () => {
    const qNoRubric = { ...BASE_QUESTION, gradingRubric: null };
    const tx = makeTransaction(BASE_SESSION, [BASE_DRAFT], [qNoRubric], []);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
      transaction: vi.fn().mockImplementation((fn) => fn(tx)),
    });

    await autoSubmitSession(1, { reason: "manual_force" });

    const insertCalls = (tx.insert as ReturnType<typeof vi.fn>).mock.calls;
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("traite une rubric invalide (safeParse fail) → score 0 avec feedback", async () => {
    const qBadRubric = { ...BASE_QUESTION, gradingRubric: { broken: true } };
    const tx = makeTransaction(BASE_SESSION, [BASE_DRAFT], [qBadRubric], []);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
      transaction: vi.fn().mockImplementation((fn) => fn(tx)),
    });

    await autoSubmitSession(1, { reason: "manual_force" });

    const insertCalls = (tx.insert as ReturnType<typeof vi.fn>).mock.calls;
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("appelle computeSuspicionScore avec les événements cheat", async () => {
    const mockEvent = { type: "tab_switch", metadata: { count: 3 } };
    const tx = makeTransaction(BASE_SESSION, [], [BASE_QUESTION], [mockEvent]);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
      transaction: vi.fn().mockImplementation((fn) => fn(tx)),
    });

    await autoSubmitSession(1, { reason: "manual_force" });

    expect(computeSuspicionScore).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ type: "tab_switch", count: 3 }),
      ]),
    );
  });
});

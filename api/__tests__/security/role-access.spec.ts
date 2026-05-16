import { describe, it, expect } from "vitest";
import { sessionRouter } from "../../routers/session-router";
import { questionRouter } from "../../routers/question-router";
import type { TrpcContext } from "../../context";

/**
 * III.2 — Tests de contrôle d'accès par rôle.
 * Vérifie que les routes prof sont inaccessibles aux élèves et anonymes.
 */

function makeCtx(overrides: Partial<TrpcContext> = {}): TrpcContext {
  return {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    ...overrides,
  };
}

describe("role-access : routes enseignant", () => {
  it("session.getAllForTeacher refuse un contexte sans utilisateur", async () => {
    const caller = sessionRouter.createCaller(makeCtx());
    await expect(caller.getAllForTeacher()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("session.getAllForTeacher refuse un utilisateur avec rôle student", async () => {
    const caller = sessionRouter.createCaller(makeCtx({
      user: {
        id: 1,
        unionId: "student-union-id",
        name: "Élève Test",
        email: null,
        avatar: null,
        role: "student" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignInAt: new Date(),
      },
    }));
    await expect(caller.getAllForTeacher()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("question.getWithAnswersForTeacher refuse un contexte sans utilisateur", async () => {
    const caller = questionRouter.createCaller(makeCtx());
    await expect(
      caller.getWithAnswersForTeacher({ evaluationId: 1 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("question.getWithAnswersForTeacher refuse un rôle student", async () => {
    const caller = questionRouter.createCaller(makeCtx({
      user: {
        id: 2,
        unionId: "student-union-id",
        name: "Élève Test",
        email: null,
        avatar: null,
        role: "student" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignInAt: new Date(),
      },
    }));
    await expect(
      caller.getWithAnswersForTeacher({ evaluationId: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("role-access : routes élève protégées", () => {
  it("session.submit refuse un contexte sans studentSession", async () => {
    const caller = sessionRouter.createCaller(makeCtx());
    await expect(
      caller.submit({ answers: [], timeSpent: 0 }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("session.heartbeat refuse un contexte sans studentSession", async () => {
    const caller = sessionRouter.createCaller(makeCtx());
    await expect(caller.heartbeat({ clientTime: Date.now(), focused: true, currentQuestionIndex: 0, fingerprintHash: "abc" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

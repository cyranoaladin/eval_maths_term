import { describe, it, expect } from "vitest";
import { cheatRouter } from "../../routers/cheat-router";
import type { TrpcContext } from "../../context";
import type { StudentSessionPayload } from "../../anticheat/session-token";

/**
 * III.5 — Tests d'immutabilité des cheat events.
 * Vérifie que :
 * 1. Le client ne peut pas reporter plus de 50 événements à la fois
 * 2. Les événements sont append-only (pas de PUT / DELETE)
 * 3. La route cheat.report exige un studentSession valide
 */

/**
 * Une charge utile telle qu'un client hostile peut l'envoyer : elle ne respecte
 * pas le contrat, et c'est tout l'intérêt. Le typage du routeur décrit ce que
 * l'application accepte, pas ce qui arrive sur le réseau — on nomme donc la
 * fiction ici plutôt que de faire taire le vérificateur au point d'appel.
 */
function chargeHostile<T>(charge: unknown): T {
  return charge as T;
}

function makeCtxWithSession(sessionId: number): TrpcContext {
  const studentSession: StudentSessionPayload = {
    sessionId,
    evaluationId: 1,
    studentName: "Élève Test",
    startedAt: Date.now(),
    expiresAt: Date.now() + 3600 * 1000,
    shuffleSeed: "seed123",
  };
  return {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    studentSession,
  };
}

describe("cheat-immutability : validation des inputs", () => {
  it("cheat.report refuse un tableau vide", async () => {
    const caller = cheatRouter.createCaller(makeCtxWithSession(1));
    await expect(
      caller.report({ events: [] }),
    ).rejects.toThrow();
  });

  it("cheat.report refuse plus de 50 événements à la fois", async () => {
    const caller = cheatRouter.createCaller(makeCtxWithSession(1));
    const tooManyEvents = Array.from({ length: 51 }, (_, i) => ({
      type: "tab_switch" as const,
      timestamp: Date.now() + i * 1000,
    }));
    await expect(
      caller.report({ events: tooManyEvents }),
    ).rejects.toThrow();
  });

  it("cheat.report refuse un type d'événement inconnu", async () => {
    const caller = cheatRouter.createCaller(makeCtxWithSession(1));
    await expect(
      caller.report(
        chargeHostile<Parameters<typeof caller.report>[0]>({
          events: [
            { type: "hack_attempt", timestamp: new Date().toISOString() },
          ],
        }),
      ),
    ).rejects.toThrow();
  });

  it("cheat.report refuse sans studentSession", async () => {
    const caller = cheatRouter.createCaller({
      req: new Request("http://localhost"),
      resHeaders: new Headers(),
    });
    await expect(
      caller.report({
        events: [{ type: "tab_switch", timestamp: Date.now() }],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("le count d'événements est limité à 100", async () => {
    // Vérifie la validation Zod — count > 100 doit échouer
    const caller = cheatRouter.createCaller(makeCtxWithSession(1));
    await expect(
      caller.report({
        events: [
          {
            type: "copy",
            timestamp: Date.now(),
            count: 101,
          },
        ],
      }),
    ).rejects.toThrow();
  });
});

describe("cheat-immutability : absence de routes de modification", () => {
  it("cheat-router n'a pas de route update ou delete", () => {
    const keys = Object.keys(cheatRouter._def.record);
    expect(keys).not.toContain("update");
    expect(keys).not.toContain("delete");
    expect(keys).not.toContain("clear");
    expect(keys).not.toContain("reset");
  });

  it("cheat-router n'a qu'une route, et c'est une écriture", () => {
    const keys = Object.keys(cheatRouter._def.record);
    expect(keys).toEqual(["report"]);
  });
});

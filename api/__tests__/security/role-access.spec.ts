import { describe, it, expect } from "vitest";
import { authoringRouter } from "../../routers/authoring-router";
import { sessionRouter } from "../../routers/session-router";
import { questionRouter } from "../../routers/question-router";
import type { TrpcContext } from "../../context";
import type { User } from "@db/schema";

/**
 * Qui entre, et à quelles conditions.
 *
 * Deux failles vivaient ici. `users.role` avait `teacher` pour valeur par
 * défaut : toute personne capable d'ouvrir une session chez le fournisseur
 * OAuth devenait enseignante à sa première connexion. Et le contrôle de rôle
 * comparait à « teacher » exactement, ce qui excluait les administrateurs de
 * toutes les routes enseignant — le propriétaire déclaré par `OWNER_UNION_ID`
 * était enfermé dehors de sa propre installation.
 */

function utilisateur(
  role: User["role"],
  status: User["status"] = "active",
  id = 1,
): User {
  return {
    id,
    unionId: `union-${role}-${status}-${id}`,
    name: "Compte de test",
    email: null,
    avatar: null,
    role,
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignInAt: new Date(),
  };
}

function makeCtx(overrides: Partial<TrpcContext> = {}): TrpcContext {
  return {
    req: new Request("http://localhost/api/trpc"),
    resHeaders: new Headers(),
    ...overrides,
  };
}

describe("role-access : routes enseignant", () => {
  it("refuse un contexte sans utilisateur", async () => {
    const caller = authoringRouter.createCaller(makeCtx());
    await expect(caller.listEvaluations()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("refuse un rôle student", async () => {
    const caller = authoringRouter.createCaller(
      makeCtx({ user: utilisateur("student") }),
    );
    await expect(caller.listEvaluations()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuse un enseignant dont le compte attend son autorisation", async () => {
    // C'est l'état d'un compte inconnu qui vient de se connecter.
    const caller = authoringRouter.createCaller(
      makeCtx({ user: utilisateur("teacher", "pending") }),
    );
    await expect(caller.listEvaluations()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuse un enseignant dont l'accès a été révoqué", async () => {
    const caller = authoringRouter.createCaller(
      makeCtx({ user: utilisateur("teacher", "disabled") }),
    );
    await expect(caller.listEvaluations()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("laisse passer un administrateur actif", async () => {
    // Sans quoi le propriétaire de l'installation n'atteindrait aucun écran.
    const caller = authoringRouter.createCaller(
      makeCtx({ user: utilisateur("admin") }),
    );
    await expect(caller.listEvaluations()).resolves.toBeDefined();
  });

  it("question.getForActiveSession refuse un contexte sans jeton élève", async () => {
    const caller = questionRouter.createCaller(makeCtx());
    await expect(caller.getForActiveSession()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
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
    await expect(
      caller.heartbeat({
        clientTime: Date.now(),
        focused: true,
        currentQuestionIndex: 0,
        fingerprintHash: "abc",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

import { describe, it, expect } from "vitest";
import { appRouter } from "../../router";
import { lireJetonEleve } from "../../middleware";
import { signStudentToken } from "../../anticheat/session-token";
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


describe("le message dit ce qu'il faut faire", () => {
  it("distingue un compte en attente d'un compte révoqué", async () => {
    const enAttente = appRouter.createCaller(
      makeCtx({ user: utilisateur("teacher", "pending") }),
    );
    await expect(enAttente.authoring.listEvaluations()).rejects.toThrow(
      /attend l'autorisation/,
    );

    const revoque = appRouter.createCaller(
      makeCtx({ user: utilisateur("teacher", "disabled") }),
    );
    // Deux situations différentes : l'une s'attend, l'autre se conteste.
    await expect(revoque.authoring.listEvaluations()).rejects.not.toThrow(
      /attend l'autorisation/,
    );
  });

  it("laisse un compte en attente lire sa propre fiche", async () => {
    // Sans cela, l'interface ne pourrait pas lui dire pourquoi il n'a accès à
    // rien : elle le renverrait à la page de connexion en boucle.
    const enAttente = appRouter.createCaller(
      makeCtx({ user: utilisateur("teacher", "pending") }),
    );

    await expect(enAttente.auth.me()).resolves.toMatchObject({ status: "pending" });
  });

  it("refuse l'administration à un enseignant, et à un anonyme", async () => {
    const prof = appRouter.createCaller(makeCtx({ user: utilisateur("teacher") }));
    await expect(prof.access.listUsers()).rejects.toThrow();

    const personne = appRouter.createCaller(makeCtx());
    await expect(personne.access.listUsers()).rejects.toThrow();
  });
});

describe("jeton élève", () => {
  const entetes = (h: Record<string, string>) => ({
    headers: { get: (n: string) => h[n.toLowerCase()] ?? null },
  });

  it("se lit dans l'en-tête dédié comme dans un Bearer", () => {
    expect(lireJetonEleve(entetes({ "x-student-session-token": "abc" }))).toBe("abc");
    expect(lireJetonEleve(entetes({ authorization: "Bearer xyz" }))).toBe("xyz");
    // L'en-tête dédié prime : c'est celui que le client de l'application pose.
    expect(
      lireJetonEleve(entetes({ "x-student-session-token": "abc", authorization: "Bearer xyz" })),
    ).toBe("abc");
  });

  it("ne prend rien d'un en-tête qui n'est pas un Bearer", () => {
    expect(lireJetonEleve(entetes({ authorization: "Basic abc" }))).toBe("");
    expect(lireJetonEleve(entetes({}))).toBe("");
  });

  it("accepte un jeton présenté en Bearer par une route élève", async () => {
    const jeton = await signStudentToken({
      sessionId: 999_999_997,
      evaluationId: 999_999_997,
      studentName: "Élève au Bearer",
      startedAt: Date.now(),
      expiresAt: Date.now() + 600_000,
      shuffleSeed: "graine",
    });
    const api = appRouter.createCaller(
      makeCtx({
        req: new Request("http://localhost/api/trpc", {
          headers: { authorization: `Bearer ${jeton}` },
        }),
      }),
    );

    // Le jeton passe la porte : c'est la copie qui n'existe pas, pas l'accès.
    await expect(api.session.submit({ answers: [] })).rejects.toThrow(/Session introuvable/);
  });

  it("refuse un jeton illisible en disant pourquoi", async () => {
    const api = appRouter.createCaller(
      makeCtx({
        req: new Request("http://localhost/api/trpc", {
          headers: { "x-student-session-token": "pas-un-jeton" },
        }),
      }),
    );

    await expect(api.session.submit({ answers: [] })).rejects.toThrow();
  });
});

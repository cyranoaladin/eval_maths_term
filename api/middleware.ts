import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { verifyStudentToken, type StudentSessionPayload } from "./anticheat/session-token";
import { logger } from "./lib/logger";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;

/**
 * Route publique — uniquement pour /ping et routes anonymes non sensibles.
 */
export const publicQuery = t.procedure;

/**
 * Middleware : vérifie que l'utilisateur est authentifié (cookie JWT prof).
 */
const requireAuth = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ErrorMessages.unauthenticated,
    });
  }

  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * Middleware : vérifie le rôle de l'utilisateur authentifié.
 */
function requireRole(role: "teacher" | "admin") {
  return t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== role) {
      logger.warn("[middleware] Accès refusé : rôle insuffisant", {
        required: role,
        actual: ctx.user?.role ?? "anonymous",
      });
      throw new TRPCError({
        code: "FORBIDDEN",
        message: ErrorMessages.insufficientRole,
      });
    }

    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

/**
 * Middleware : vérifie le token de session élève passé en header Authorization.
 * Format : `Authorization: Bearer <studentSessionToken>`
 *
 * Le token est signé par le serveur à la création de session (studentSessionSecret).
 * Ce middleware peuple ctx.studentSession pour les procédures studentQuery.
 */
/**
 * En-tête qui porte le jeton de session élève.
 *
 * Une seule définition : le routeur `session.heartbeat` a longtemps lu
 * « x-session-token », un nom que personne n'émet, et le heartbeat répondait
 * 401 à chaque envoi sans que rien ne le signale côté élève.
 */
export const STUDENT_SESSION_HEADER = "x-student-session-token";

/** Lit le jeton élève d'une requête, en-tête dédié ou Bearer. */
export function lireJetonEleve(req: { headers: { get(n: string): string | null } }): string {
  const dedie = req.headers.get(STUDENT_SESSION_HEADER);
  if (dedie) return dedie;
  const bearer = req.headers.get("authorization");
  return bearer?.startsWith("Bearer ") ? bearer.slice(7) : "";
}

const requireStudentSessionToken = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  const authHeader = ctx.req.headers.get(STUDENT_SESSION_HEADER);
  const bearerHeader = ctx.req.headers.get("authorization");
  const token =
    authHeader ||
    (bearerHeader?.startsWith("Bearer ") ? bearerHeader.slice(7) : undefined);

  if (!token) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Token de session élève requis",
    });
  }

  let sessionPayload: StudentSessionPayload;
  try {
    sessionPayload = await verifyStudentToken(token);
  } catch (err) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: err instanceof Error ? err.message : "Token de session invalide",
    });
  }

  return next({ ctx: { ...ctx, studentSession: sessionPayload } });
});

/**
 * Procédure pour les routes enseignant — exige auth + rôle teacher.
 */
export const authedQuery = t.procedure.use(requireAuth);
export const teacherQuery = t.procedure.use(requireAuth).use(requireRole("teacher"));

/**
 * Procédure pour les routes admin — exige auth + rôle admin.
 */
export const adminQuery = t.procedure.use(requireAuth).use(requireRole("admin"));

/**
 * Procédure pour les routes élève — exige un sessionToken élève valide.
 */
export const studentQuery = t.procedure.use(requireStudentSessionToken);

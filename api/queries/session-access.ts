/**
 * api/queries/session-access.ts
 *
 * « Cette copie est-elle encore inscriptible ? »
 *
 * La question se posait à deux endroits — `session-router` et `answer-router` —
 * et recevait deux réponses différentes. Les deux refusaient une session
 * terminée ou expirée, mais seul le premier *scellait* la session expirée en
 * `timed_out`. Selon la route qu'un élève touchait en premier après la fin du
 * temps imparti, sa copie restait donc « en cours » indéfiniment ou passait en
 * temps dépassé. Deux réponses à une question qui n'en admet qu'une.
 *
 * Le scellement est le bon comportement : le temps est écoulé, la copie ne peut
 * plus bouger, et l'enseignant doit la voir dans cet état.
 */
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "./connection";
import { questions, sessions } from "@db/schema";
import type { Session } from "@db/schema";

/**
 * Vérifie que la session est en cours et que le temps imparti n'est pas écoulé.
 * Scelle la session si elle vient d'expirer, puis lève.
 */
export async function assertSessionActive(sessionId: number): Promise<Session> {
  const db = getDb();
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Session introuvable" });
  }

  if (session.status !== "in_progress") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cette session est déjà terminée",
    });
  }

  if (session.expiresAt && Date.now() > session.expiresAt.getTime()) {
    // Le temps décidé par le serveur fait foi, pas l'horloge du navigateur.
    await db
      .update(sessions)
      .set({ status: "timed_out", endedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Session expirée : le temps imparti est écoulé",
    });
  }

  return session;
}

/**
 * Vérifie qu'une question appartient bien à l'évaluation de la session.
 *
 * Sans ce contrôle, un élève muni d'un jeton valide écrirait dans la copie
 * d'une autre évaluation en changeant un identifiant.
 */
export async function assertQuestionDeLEvaluation(
  questionId: number,
  evaluationId: number,
): Promise<void> {
  const db = getDb();
  const [question] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.id, questionId), eq(questions.evaluationId, evaluationId)))
    .limit(1);

  if (!question) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Question introuvable pour cette évaluation",
    });
  }
}

/**
 * api/queries/ownership.ts
 *
 * Qui a le droit de toucher à quoi.
 *
 * Les routes `teacherQuery` vérifiaient l'authentification mais pas la
 * propriété : n'importe quel enseignant connecté pouvait lire, recorriger et
 * modifier les copies d'un autre, à partir du seul identifiant de session.
 * Sur une plateforme d'établissement, c'est un accès aux notes de tout le
 * monde.
 *
 * Règle retenue : une session appartient à l'enseignant propriétaire de son
 * évaluation. Les évaluations sans propriétaire — celles créées avant
 * l'introduction du champ, dont l'évaluation de référence — restent partagées :
 * les rendre inaccessibles couperait l'usage existant sans rien protéger.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, isNull, or } from "drizzle-orm";
import { getDb } from "./connection";
import { evaluations, responses, sessions } from "@db/schema";

export interface SessionAccessible {
  sessionId: number;
  evaluationId: number;
}

/**
 * Vérifie qu'un enseignant peut agir sur une session, et renvoie de quoi
 * poursuivre. Lève `NOT_FOUND` — jamais `FORBIDDEN` — pour ne pas révéler
 * l'existence d'une session appartenant à quelqu'un d'autre.
 */
export async function assertSessionAccessible(
  sessionId: number,
  userId: number,
): Promise<SessionAccessible> {
  const db = getDb();
  const [ligne] = await db
    .select({ id: sessions.id, evaluationId: sessions.evaluationId })
    .from(sessions)
    .innerJoin(evaluations, eq(evaluations.id, sessions.evaluationId))
    .where(
      and(
        eq(sessions.id, sessionId),
        or(eq(evaluations.ownerId, userId), isNull(evaluations.ownerId)),
      ),
    )
    .limit(1);

  if (!ligne) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Session introuvable" });
  }
  return { sessionId: ligne.id, evaluationId: ligne.evaluationId };
}

/**
 * Même contrôle à partir d'une réponse : c'est l'identifiant manipulé par
 * l'écran de correction.
 */
export async function assertResponseAccessible(
  responseId: number,
  userId: number,
): Promise<{ responseId: number; sessionId: number; evaluationId: number }> {
  const db = getDb();
  const [ligne] = await db
    .select({ id: responses.id, sessionId: responses.sessionId })
    .from(responses)
    .where(eq(responses.id, responseId))
    .limit(1);

  if (!ligne) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Réponse introuvable" });
  }
  const acces = await assertSessionAccessible(ligne.sessionId, userId);
  return { responseId: ligne.id, ...acces };
}

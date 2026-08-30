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
import { classes, evaluations, questions, sessions, students } from "@db/schema";
import type { Evaluation } from "@db/schema";

/**
 * Vérifie qu'un enseignant peut agir sur une évaluation.
 *
 * Cette règle vivait dans `authoring-router`, où seul l'atelier de rédaction la
 * connaissait. Deux routes hors de l'atelier acceptaient donc un identifiant
 * d'évaluation sans rien vérifier : le suivi en direct, qui rendait les noms,
 * courriels, scores de suspicion et incidents des élèves de n'importe quelle
 * évaluation ; et la génération de sujets papier, qui imprimait — corrigé
 * compris — l'évaluation d'un autre enseignant. Une règle de cloisonnement n'a
 * qu'un seul endroit où vivre.
 */
export async function assertEvaluationAccessible(
  evaluationId: number,
  userId: number,
): Promise<Evaluation> {
  const db = getDb();
  const [ligne] = await db
    .select()
    .from(evaluations)
    .where(
      and(
        eq(evaluations.id, evaluationId),
        or(eq(evaluations.ownerId, userId), isNull(evaluations.ownerId)),
      ),
    )
    .limit(1);

  if (!ligne) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Évaluation introuvable ou appartenant à un autre enseignant",
    });
  }
  return ligne;
}

/** Une classe appartient à l'enseignant qui l'a créée. Pas de partage. */
export async function assertOwnedClass(classId: number, userId: number) {
  const db = getDb();
  const [ligne] = await db
    .select()
    .from(classes)
    .where(and(eq(classes.id, classId), eq(classes.ownerId, userId)))
    .limit(1);
  if (!ligne) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Classe introuvable" });
  }
  return ligne;
}

/**
 * Un élève appartient à l'enseignant propriétaire de sa classe.
 *
 * Les deux routes qui exercent les droits d'une personne sur ses données —
 * accès et effacement — refaisaient chacune la même vérification en deux temps.
 * Ce sont précisément les deux endroits où se tromper de destinataire coûte le
 * plus cher.
 */
export async function assertOwnedStudent(studentId: number, userId: number) {
  const db = getDb();
  const [eleve] = await db
    .select({ id: students.id, classId: students.classId })
    .from(students)
    .where(eq(students.id, studentId))
    .limit(1);
  if (!eleve) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Élève introuvable" });
  }
  await assertOwnedClass(eleve.classId, userId);
  return eleve;
}

/**
 * Vérifie qu'un enseignant peut agir sur une question, par son évaluation.
 * `updateQuestion` et `deleteQuestion` refaisaient le même détour.
 */
export async function assertQuestionAccessible(
  questionId: number,
  userId: number,
): Promise<{ questionId: number; evaluationId: number }> {
  const db = getDb();
  const [ligne] = await db
    .select({ evaluationId: questions.evaluationId })
    .from(questions)
    .where(eq(questions.id, questionId))
    .limit(1);
  if (!ligne) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Question introuvable" });
  }
  await assertEvaluationAccessible(ligne.evaluationId, userId);
  return { questionId, evaluationId: ligne.evaluationId };
}

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

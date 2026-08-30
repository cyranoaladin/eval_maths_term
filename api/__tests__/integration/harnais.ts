/**
 * api/__tests__/integration/harnais.ts
 *
 * Outillage des tests d'intégration : une vraie base, de vrais appels de
 * procédures, de vrais contextes d'authentification.
 *
 * Ce qui est éprouvé ici ne l'est nulle part ailleurs — la propriété des
 * données, les transactions, les invariants qui traversent plusieurs tables.
 * Une base simulée ne dirait rien de tout cela : c'est le comportement de la
 * base elle-même qui est en cause.
 *
 * Chaque suite nettoie ce qu'elle crée : les tests partagent un schéma, et un
 * test qui laisse des lignes derrière lui fait échouer le suivant sans que
 * personne comprenne pourquoi.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { appRouter } from "../../router";
import type { TrpcContext } from "../../context";
import { getDb } from "../../queries/connection";
import {
  answerDrafts, cheatEvents, classes, evaluations, gradeAudit, paperCopies,
  paperExams, questions, responses, sessions, students, users,
} from "@db/schema";
import type { User } from "@db/schema";
import { signStudentToken } from "../../anticheat/session-token";

export const db = getDb();

/** Contexte anonyme : ni enseignant, ni session élève. */
export function contexteAnonyme(entetes: Record<string, string> = {}): TrpcContext {
  return {
    req: new Request("http://localhost/api/trpc", { headers: entetes }),
    resHeaders: new Headers(),
    requestId: "test-integration",
  };
}

/** Contexte enseignant : l'utilisateur est déjà résolu, comme après OAuth. */
export function contexteEnseignant(user: User): TrpcContext {
  return { ...contexteAnonyme(), user };
}

/** Contexte élève : le jeton est présenté comme le fait le client. */
export function contexteEleve(jeton: string): TrpcContext {
  return contexteAnonyme({ "x-student-session-token": jeton });
}

export const appelAnonyme = () => appRouter.createCaller(contexteAnonyme());
export const appelEnseignant = (user: User) => appRouter.createCaller(contexteEnseignant(user));
export const appelEleve = (jeton: string) => appRouter.createCaller(contexteEleve(jeton));

let compteur = 0;
/** Suffixe unique : les suites partagent la base, les noms doivent différer. */
export function unique(prefixe: string): string {
  compteur += 1;
  return `${prefixe}-${process.pid}-${compteur}`;
}

/**
 * Crée un enseignant et le renvoie tel que le contexte l'attend.
 *
 * `status` est écrit explicitement : le défaut est « en attente », et un compte
 * en attente n'ouvre rien. Un harnais qui ne le disait pas produirait des
 * enseignants sans accès, ou — plus dangereux — masquerait le jour où ce défaut
 * changerait.
 */
export async function creerEnseignant(
  nom = "Enseignant",
  role: User["role"] = "teacher",
  status: User["status"] = "active",
): Promise<User> {
  const unionId = unique("union");
  await db.insert(users).values({
    unionId,
    name: nom,
    email: `${unionId}@test.local`,
    role,
    status,
  });
  const [u] = await db.select().from(users).where(eq(users.unionId, unionId)).limit(1);
  return u;
}

export interface EvaluationDeTest {
  evaluationId: number;
  questionIds: number[];
}

/**
 * Une évaluation minimale mais complète : un QCM, un vrai/faux et une réponse
 * courte, c'est-à-dire les trois chemins de correction.
 */
export async function creerEvaluation(
  proprietaire: User | null,
  titre = "Évaluation d'intégration",
): Promise<EvaluationDeTest> {
  const [ev] = await db.insert(evaluations).values({
    title: unique(titre),
    description: "Créée par les tests d'intégration",
    duration: 30,
    isActive: true,
    ownerId: proprietaire?.id ?? null,
  });
  const evaluationId = Number(ev.insertId);

  const definitions = [
    {
      type: "qcm" as const,
      question: "Combien font deux et deux ?",
      options: JSON.stringify(["$3$", "$4$", "$5$", "$6$"]),
      correctAnswer: "1",
      points: 2,
      order: 1,
      gradingRubric: { mode: { kind: "qcm", correctIndex: 1 }, llmReviewRequired: false, weight: 2 },
    },
    {
      type: "true_false" as const,
      question: "La fonction carré est croissante sur $\\mathbb{R}$.",
      options: null,
      correctAnswer: "false",
      points: 1,
      order: 2,
      gradingRubric: { mode: { kind: "true_false", correctValue: "false" }, llmReviewRequired: false, weight: 1 },
    },
    {
      type: "short_answer" as const,
      question: "Quelle est la dérivée de $x^2$ ?",
      options: null,
      correctAnswer: "2*x",
      points: 3,
      order: 3,
      gradingRubric: {
        mode: { kind: "symbolic", canonical: "2*x", variables: ["x"] },
        llmReviewRequired: false,
        weight: 3,
      },
    },
  ];

  const questionIds: number[] = [];
  for (const d of definitions) {
    const [q] = await db.insert(questions).values({ ...d, evaluationId });
    questionIds.push(Number(q.insertId));
  }
  return { evaluationId, questionIds };
}

/** Ouvre une session élève et renvoie son jeton, comme `session.start`. */
export async function ouvrirSession(
  evaluationId: number,
  nomEleve = "Élève de test",
): Promise<{ sessionId: number; jeton: string }> {
  const debut = Date.now();
  const [row] = await db.insert(sessions).values({
    evaluationId,
    studentName: nomEleve,
    status: "in_progress",
    shuffleSeed: "graine-integration",
    startedAt: new Date(debut),
    expiresAt: new Date(debut + 3_600_000),
  });
  const sessionId = Number(row.insertId);
  const jeton = await signStudentToken({
    sessionId,
    evaluationId,
    studentName: nomEleve,
    startedAt: debut,
    expiresAt: debut + 3_600_000,
    shuffleSeed: "graine-integration",
  });
  return { sessionId, jeton };
}

/**
 * Efface tout ce qu'une suite a créé, dans l'ordre des dépendances.
 * Les clés étrangères sont en `restrict` : l'ordre n'est pas décoratif.
 */
export async function nettoyer(evaluationIds: number[], userIds: number[] = []) {
  if (evaluationIds.length) {
    const sess = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(inArray(sessions.evaluationId, evaluationIds));
    const ids = sess.map((s) => s.id);
    if (ids.length) {
      await db.delete(gradeAudit).where(inArray(gradeAudit.sessionId, ids));
      await db.delete(answerDrafts).where(inArray(answerDrafts.sessionId, ids));
      await db.delete(cheatEvents).where(inArray(cheatEvents.sessionId, ids));
      await db.delete(paperCopies).where(inArray(paperCopies.sessionId, ids));
      await db.delete(responses).where(inArray(responses.sessionId, ids));
    }
    const exams = await db
      .select({ id: paperExams.id })
      .from(paperExams)
      .where(inArray(paperExams.evaluationId, evaluationIds));
    if (exams.length) {
      await db.delete(paperCopies).where(inArray(paperCopies.paperExamId, exams.map((e) => e.id)));
      await db.delete(paperExams).where(inArray(paperExams.id, exams.map((e) => e.id)));
    }
    if (ids.length) await db.delete(sessions).where(inArray(sessions.id, ids));
    await db.delete(questions).where(inArray(questions.evaluationId, evaluationIds));
    await db.delete(evaluations).where(inArray(evaluations.id, evaluationIds));
  }
  if (userIds.length) {
    const cls = await db.select({ id: classes.id }).from(classes).where(inArray(classes.ownerId, userIds));
    if (cls.length) {
      await db.delete(students).where(inArray(students.classId, cls.map((c) => c.id)));
      await db.delete(classes).where(inArray(classes.id, cls.map((c) => c.id)));
    }
    await db.delete(users).where(inArray(users.id, userIds));
  }
}

/** Vrai si la base d'intégration répond. */
export async function baseDisponible(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

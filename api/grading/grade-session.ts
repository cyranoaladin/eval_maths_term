/**
 * api/grading/grade-session.ts
 *
 * Correction d'une session complète — source de vérité unique.
 *
 * Trois appelants : `session.submit` (soumission élève), `grading2.gradeSession`
 * (relance manuelle par l'enseignant) et `auto-submit` (via
 * `resolveSubmittedQcmIndex`). Avant la Phase 3.5 chacun réimplémentait sa
 * propre correction, avec trois résultats différents pour la même copie.
 *
 * Règles :
 * - La rubric est lue en base côté serveur : elle ne transite jamais par le client.
 * - Pour un QCM, l'index soumis est exprimé dans l'ordre mélangé vu par l'élève ;
 *   il faut le reconvertir en index d'origine avant toute comparaison.
 * - Idempotent : relancer la correction met à jour les scores existants.
 * - normalizedScore = round(totalScore/maxScore*20*4)/4 → sur 20 au quart de point.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { questions, responses, sessions } from "@db/schema";
import { GradingRubricSchema } from "../../contracts/grading-rubric";
import { logger } from "../lib/logger";
import { toDecimal, toNumberOr } from "../lib/decimal";
import { gradeResponse } from "./grade-response";
import { resolveOriginalIndex, shuffleDeterministic } from "./shuffle";

/**
 * Graine de mélange des options d'une question.
 * DOIT rester identique à celle de `question.getForActiveSession`, sinon les
 * réponses QCM sont corrigées contre le mauvais ordre d'options.
 */
export function optionShuffleSeed(shuffleSeed: string, questionId: number): string {
  return `${shuffleSeed}-opt-${questionId}`;
}

function parseOptions(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(raw) ? (raw as string[]) : [];
}

/**
 * Convertit l'index QCM enregistré en index d'origine, celui auquel se réfère
 * `rubric.mode.correctIndex`.
 *
 * - `online` : l'élève a vu les options mélangées par `shuffleSeed`, il faut
 *   donc reconvertir sa position.
 * - `paper` : le sujet imprimé porte les options dans l'ordre d'origine et
 *   l'enseignant saisit cette position — aucune conversion, mais on valide
 *   quand même les bornes.
 *
 * Retourne `undefined` quand la réponse n'est pas corrigeable (options
 * illisibles, index hors limites, graine manquante en mode `online`).
 * `gradeResponse` la traite alors comme à corriger manuellement, jamais comme
 * fausse par accident.
 */
export function resolveSubmittedQcmIndex(args: {
  rawOptions: unknown;
  shuffleSeed: string | null;
  questionId: number;
  submittedAnswer: string;
  mode?: SessionMode;
}): number | undefined {
  const { rawOptions, shuffleSeed, questionId, submittedAnswer, mode = "online" } = args;

  const options = parseOptions(rawOptions);
  if (options.length === 0) return undefined;

  const submittedIndex = Number.parseInt(submittedAnswer, 10);
  if (Number.isNaN(submittedIndex)) return undefined;
  if (submittedIndex < 0 || submittedIndex >= options.length) return undefined;

  if (mode === "paper") return submittedIndex;

  if (!shuffleSeed) return undefined;

  const mapping = shuffleDeterministic(
    options.map((_, i) => i),
    optionShuffleSeed(shuffleSeed, questionId),
  );

  return resolveOriginalIndex(submittedIndex, mapping);
}

/** Origine de la copie — voir `sessions.mode`. */
export type SessionMode = "online" | "paper";

/**
 * Modes de correction résultant d'une décision humaine.
 *
 * Une note posée par l'enseignant ne se recalcule pas : sans cette garde, une
 * relance de la correction écrasait silencieusement les points qu'il avait
 * attribués — y compris ceux d'`overrideGrade`.
 */
const MODES_MANUELS = ["manual_override", "manual_paper"];

export function estNoteManuelle(gradingMode: string | null): boolean {
  return gradingMode !== null && MODES_MANUELS.includes(gradingMode);
}

export interface GradeSessionOptions {
  /** Ne jamais appeler le LLM (latence inacceptable en auto-submit). */
  skipLLM?: boolean;
  /**
   * Restreint le barème à ces questions.
   *
   * Une copie papier n'est notée que sur ce qui figurait sur la
   * feuille-réponses : les réponses rédigées ne s'y cochent pas et sont
   * corrigées à part. Sans cette restriction, leurs points seraient comptés
   * perdus d'office et une copie parfaite plafonnerait très en dessous de 20.
   */
  questionIds?: number[];
}

export interface GradeSessionResult {
  totalScore: number;
  maxScore: number;
  normalizedScore: number;
  gradedCount: number;
  /** Réponses laissées à l'enseignant : rubric absente, invalide, ou LLM sauté. */
  needsManualReview: number;
}

/**
 * Corrige toutes les réponses déjà enregistrées d'une session, met à jour
 * chaque `responses` puis les totaux de `sessions`.
 */
export async function gradeSessionResponses(
  sessionId: number,
  opts: GradeSessionOptions = {},
): Promise<GradeSessionResult> {
  const db = getDb();

  const [session] = await db
    .select({
      id: sessions.id,
      evaluationId: sessions.evaluationId,
      shuffleSeed: sessions.shuffleSeed,
      mode: sessions.mode,
    })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!session) {
    throw new Error(`Session ${sessionId} introuvable`);
  }

  const resps = await db
    .select()
    .from(responses)
    .where(eq(responses.sessionId, sessionId));

  const qs = await db
    .select()
    .from(questions)
    .where(eq(questions.evaluationId, session.evaluationId));

  const questionMap = new Map(qs.map((q) => [q.id, q]));

  // Périmètre de notation : toute l'évaluation par défaut, ou les seules
  // questions réellement soumises à l'élève. Une question du périmètre restée
  // sans réponse vaut 0 mais compte bien dans le total.
  const scope = opts.questionIds?.length ? new Set(opts.questionIds) : null;
  const notables = scope ? qs.filter((q) => scope.has(q.id)) : qs;
  const maxScore = notables.reduce((sum, q) => sum + q.points, 0);

  let totalScore = 0;
  let gradedCount = 0;
  let needsManualReview = 0;

  for (const resp of resps) {
    const q = questionMap.get(resp.questionId);
    if (!q) continue;
    if (scope && !scope.has(q.id)) continue;

    // Note attribuée par l'enseignant : on la conserve telle quelle.
    if (estNoteManuelle(resp.gradingMode)) {
      totalScore += toNumberOr(resp.score, 0);
      gradedCount++;
      continue;
    }

    const rubricParsed = q.gradingRubric
      ? GradingRubricSchema.safeParse(q.gradingRubric)
      : null;

    if (!rubricParsed?.success) {
      logger.warn("Correction impossible — rubric absente ou invalide", {
        questionId: q.id,
        sessionId,
      });
      await db
        .update(responses)
        .set({
          score: toDecimal(0),
          maxScore: q.points,
          isCorrect: false,
          llmFeedback: "À corriger manuellement par l'enseignant.",
          gradingMode: q.gradingRubric ? "invalid_rubric" : "missing_rubric",
          gradedAt: new Date(),
        })
        .where(eq(responses.id, resp.id));
      needsManualReview++;
      continue;
    }

    const resolvedQcmIndex =
      q.type === "qcm"
        ? resolveSubmittedQcmIndex({
            rawOptions: q.options,
            shuffleSeed: session.shuffleSeed,
            questionId: q.id,
            submittedAnswer: resp.answer,
            mode: session.mode,
          })
        : undefined;

    try {
      const result = await gradeResponse({
        questionType: q.type,
        studentAnswer: resp.answer,
        justification: resp.justification ?? undefined,
        rubric: rubricParsed.data,
        questionText: q.question,
        maxPoints: q.points,
        resolvedQcmIndex,
        skipLLM: opts.skipLLM,
      });

      if (result.needsLLM) needsManualReview++;

      await db
        .update(responses)
        .set({
          score: toDecimal(result.score),
          maxScore: result.maxPoints,
          isCorrect: result.isCorrect,
          llmFeedback: result.needsLLM
            ? "À corriger manuellement par l'enseignant."
            : result.feedback,
          gradingMode: result.gradingMode,
          llmConfidence:
            result.llmConfidence != null
              ? result.llmConfidence.toFixed(2)
              : null,
          gradingReason: result.feedback,
          partialCreditApplied: result.partialCreditApplied,
          gradedAt: new Date(),
        })
        .where(eq(responses.id, resp.id));

      totalScore += result.score;
      gradedCount++;
    } catch (e) {
      // Une réponse qui explose ne doit pas faire perdre la copie entière.
      logger.error("Erreur de correction d'une réponse", {
        responseId: resp.id,
        sessionId,
        error: String(e),
      });
      totalScore += toNumberOr(resp.score, 0);
      needsManualReview++;
    }
  }

  const normalizedScore =
    maxScore > 0 ? Math.round((totalScore / maxScore) * 20 * 4) / 4 : 0;

  await db
    .update(sessions)
    .set({
      totalScore: toDecimal(totalScore),
      maxScore,
      normalizedScore: toDecimal(normalizedScore),
    })
    .where(eq(sessions.id, sessionId));

  logger.info("Session corrigée", {
    sessionId,
    totalScore,
    maxScore,
    normalizedScore,
    gradedCount,
    needsManualReview,
  });

  return { totalScore, maxScore, normalizedScore, gradedCount, needsManualReview };
}

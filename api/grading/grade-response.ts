/**
 * api/grading/grade-response.ts
 *
 * Orchestrateur de correction.
 * Stratégie en cascade :
 *   1. QCM : comparaison directe via correctIndex (après résolution du mapping shuffle)
 *   2. true_false : comparaison de la valeur booléenne + LLM pour la justification
 *   3. short_answer :
 *      a. Formes acceptables explicites (acceptableForms)
 *      b. Comparateur selon rubric.mode (exact / numeric / symbolic / fraction / set)
 *      c. Fallback LLM si llmReviewRequired
 *
 * Retourne un GradingResult qui inclut le score, le feedback, le mode utilisé
 * et si une pénalité a été appliquée.
 */
import type { GradingRubric, ComparisonMode } from "../../contracts/grading-rubric";
import { compareExact } from "./compare-exact";
import { compareNumeric } from "./compare-numeric";
import { compareFraction, applyFractionPenalty } from "./compare-fraction";
import { areSymbolicallyEqual } from "./compare-symbolic";
import { compareSet } from "./compare-set";
import { normalizeExpression } from "./normalize";
import { gradeWithLLM } from "./llm-client";
import type { GradingPromptArgs } from "./grading-prompt";

export interface GradingResult {
  score: number;
  maxPoints: number;
  isCorrect: boolean;
  feedback: string;
  gradingMode: string;
  llmConfidence: number | null;
  partialCreditApplied: boolean;
}

export interface GradeResponseArgs {
  questionType: "qcm" | "short_answer" | "true_false";
  studentAnswer: string;
  justification?: string;
  rubric: GradingRubric;
  questionText: string;
  maxPoints: number;
  /** Index soumis par l'élève pour un QCM (déjà résolu via resolveOriginalIndex) */
  resolvedQcmIndex?: number;
}

export async function gradeResponse(args: GradeResponseArgs): Promise<GradingResult> {
  const { questionType, maxPoints } = args;

  switch (questionType) {
    case "qcm":
      return gradeQcm(args);
    case "true_false":
      return gradeTrueFalse(args);
    case "short_answer":
      return gradeShortAnswer(args);
    default:
      return {
        score: 0,
        maxPoints,
        isCorrect: false,
        feedback: `Type de question inconnu : ${questionType}`,
        gradingMode: "unknown",
        llmConfidence: null,
        partialCreditApplied: false,
      };
  }
}

// ─── QCM ──────────────────────────────────────────────────────────────────────

function gradeQcm(args: GradeResponseArgs): GradingResult {
  const { rubric, maxPoints, resolvedQcmIndex } = args;

  if (rubric.mode.kind !== "qcm") {
    return fail(maxPoints, "Rubric invalide pour un QCM");
  }

  if (resolvedQcmIndex === undefined) {
    return fail(maxPoints, "Index QCM manquant");
  }

  const correct = resolvedQcmIndex === rubric.mode.correctIndex;
  return {
    score: correct ? maxPoints : 0,
    maxPoints,
    isCorrect: correct,
    feedback: correct ? "Bonne réponse." : "Réponse incorrecte.",
    gradingMode: "qcm",
    llmConfidence: null,
    partialCreditApplied: false,
  };
}

// ─── Vrai / Faux ──────────────────────────────────────────────────────────────

async function gradeTrueFalse(args: GradeResponseArgs): Promise<GradingResult> {
  const { rubric, maxPoints, studentAnswer, justification, questionText } = args;

  if (rubric.mode.kind !== "true_false") {
    return fail(maxPoints, "Rubric invalide pour vrai/faux");
  }

  const normalizedAnswer = studentAnswer.toLowerCase().trim();
  const answerMap: Record<string, "true" | "false"> = {
    vrai: "true", true: "true", "1": "true", oui: "true", v: "true",
    faux: "false", false: "false", "0": "false", non: "false", f: "false",
  };

  const parsedAnswer = answerMap[normalizedAnswer];
  if (!parsedAnswer) {
    return fail(maxPoints, `Réponse "${studentAnswer}" non reconnue — attendu : vrai ou faux`);
  }

  const answerCorrect = parsedAnswer === rubric.mode.correctValue;

  if (!answerCorrect) {
    // La réponse est fausse → 0 sans même évaluer la justification
    return {
      score: 0,
      maxPoints,
      isCorrect: false,
      feedback: `La réponse est incorrecte (attendu : ${rubric.mode.correctValue === "true" ? "Vrai" : "Faux"}).`,
      gradingMode: "true_false",
      llmConfidence: null,
      partialCreditApplied: false,
    };
  }

  // Réponse correcte (1 pt) + justification via LLM si requise
  const answerPts = Math.round(maxPoints / 2);

  if (!rubric.llmReviewRequired || !justification) {
    const score = answerCorrect ? maxPoints : 0;
    return {
      score,
      maxPoints,
      isCorrect: answerCorrect,
      feedback: answerCorrect
        ? justification
          ? "Réponse correcte. Justification non évaluée automatiquement."
          : "Réponse correcte. Aucune justification fournie."
        : "Réponse incorrecte.",
      gradingMode: "true_false",
      llmConfidence: null,
      partialCreditApplied: false,
    };
  }

  // Correction LLM de la justification
  try {
    const llmArgs: GradingPromptArgs = {
      question: questionText,
      expectedAnswer: rubric.mode.correctValue,
      studentAnswer,
      justification,
      questionType: "true_false",
      maxPoints,
      detailedRubric: rubric.detailedRubric ?? `Réponse correcte : ${rubric.mode.correctValue}. Justification requise.`,
    };
    const llmResult = await gradeWithLLM(llmArgs);
    // Clamp : la réponse textuelle est correcte, donc au moins answerPts
    const finalScore = Math.max(answerPts, llmResult.score);
    return {
      score: finalScore,
      maxPoints,
      isCorrect: finalScore >= maxPoints,
      feedback: llmResult.feedback,
      gradingMode: "true_false+llm",
      llmConfidence: llmResult.confidence,
      partialCreditApplied: finalScore < maxPoints,
    };
  } catch {
    // LLM indisponible → demi-score sur la réponse seule
    return {
      score: answerPts,
      maxPoints,
      isCorrect: false,
      feedback: "Réponse correcte. Justification non évaluée (service indisponible).",
      gradingMode: "true_false+llm_failed",
      llmConfidence: null,
      partialCreditApplied: true,
    };
  }
}

// ─── Réponse courte ───────────────────────────────────────────────────────────

async function gradeShortAnswer(args: GradeResponseArgs): Promise<GradingResult> {
  const { rubric, maxPoints, studentAnswer, questionText } = args;

  if (!studentAnswer.trim()) {
    return fail(maxPoints, "Réponse vide.");
  }

  // 1. Formes acceptables explicites (comparaison après normalisation)
  if (rubric.acceptableForms?.length) {
    const normGiven = normalizeExpression(studentAnswer);
    for (const form of rubric.acceptableForms) {
      if (normalizeExpression(form) === normGiven) {
        return pass(maxPoints, `Forme acceptée ("${form}").`, "acceptable_form");
      }
    }
  }

  // 2. Comparateur selon mode
  const modeResult = await applyComparisonMode(rubric.mode, studentAnswer, maxPoints);
  if (modeResult !== null) {
    if (modeResult.isCorrect) return modeResult;

    // Avant de retourner faux, vérifier les règles de crédit partiel
    if (rubric.partialCredit?.length) {
      for (const rule of rubric.partialCredit) {
        if (matchesPartialRule(studentAnswer, rule)) {
          return {
            score: Math.min(rule.score, maxPoints),
            maxPoints,
            isCorrect: false,
            feedback: `Crédit partiel : ${rule.rule}`,
            gradingMode: "partial_credit",
            llmConfidence: null,
            partialCreditApplied: true,
          };
        }
      }
    }

    if (!rubric.llmReviewRequired) {
      return modeResult;
    }
  }

  // 3. Fallback LLM
  if (rubric.llmReviewRequired) {
    try {
      const llmArgs: GradingPromptArgs = {
        question: questionText,
        expectedAnswer: rubric.mode.kind === "symbolic"
          ? rubric.mode.canonical
          : rubric.mode.kind === "numeric"
            ? String(rubric.mode.value)
            : studentAnswer,
        studentAnswer,
        questionType: "short_answer",
        maxPoints,
        detailedRubric: rubric.detailedRubric ?? "Corriger selon le sens mathématique.",
      };
      const llmResult = await gradeWithLLM(llmArgs);
      return {
        score: llmResult.score,
        maxPoints,
        isCorrect: llmResult.score >= maxPoints,
        feedback: llmResult.feedback,
        gradingMode: "llm",
        llmConfidence: llmResult.confidence,
        partialCreditApplied: llmResult.score > 0 && llmResult.score < maxPoints,
      };
    } catch {
      return fail(maxPoints, "Correction automatique indisponible. À évaluer manuellement.");
    }
  }

  return modeResult ?? fail(maxPoints, "Comparaison impossible.");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function applyComparisonMode(
  mode: ComparisonMode,
  given: string,
  maxPoints: number,
): Promise<GradingResult | null> {
  switch (mode.kind) {
    case "exact": {
      const r = compareExact("", given);
      return {
        score: r.equal ? maxPoints : 0,
        maxPoints,
        isCorrect: r.equal,
        feedback: r.reason,
        gradingMode: "exact",
        llmConfidence: null,
        partialCreditApplied: false,
      };
    }

    case "numeric": {
      const r = compareNumeric(mode, given);
      return {
        score: r.equal ? maxPoints : 0,
        maxPoints,
        isCorrect: r.equal,
        feedback: r.reason,
        gradingMode: "numeric",
        llmConfidence: null,
        partialCreditApplied: false,
      };
    }

    case "fraction": {
      const r = compareFraction(mode, given);
      const score = r.equal ? applyFractionPenalty(maxPoints, r.penalty) : 0;
      return {
        score,
        maxPoints,
        isCorrect: r.equal && r.penalty === 0,
        feedback: r.reason,
        gradingMode: "fraction",
        llmConfidence: null,
        partialCreditApplied: r.equal && r.penalty > 0,
      };
    }

    case "symbolic": {
      const r = await areSymbolicallyEqual(mode.canonical, given, mode.variables);
      return {
        score: r.equal ? maxPoints : 0,
        maxPoints,
        isCorrect: r.equal,
        feedback: r.reason,
        gradingMode: `symbolic:${r.strategy}`,
        llmConfidence: null,
        partialCreditApplied: false,
      };
    }

    case "set": {
      const r = compareSet(mode, given);
      return {
        score: r.equal ? maxPoints : 0,
        maxPoints,
        isCorrect: r.equal,
        feedback: r.reason,
        gradingMode: "set",
        llmConfidence: null,
        partialCreditApplied: false,
      };
    }

    case "true_false":
    case "qcm":
      return null; // Géré dans les branches spécialisées
  }
}

function matchesPartialRule(
  given: string,
  rule: { matcherKind: string; pattern?: string },
): boolean {
  if (rule.matcherKind === "regex" && rule.pattern) {
    try {
      return new RegExp(rule.pattern).test(given);
    } catch {
      return false;
    }
  }
  if (rule.matcherKind === "fractionEquivalent" && rule.pattern) {
    // Approximation : vérifier la valeur décimale
    const n = parseFloat(given.replace(",", "."));
    const target = parseFloat(rule.pattern);
    return !isNaN(n) && !isNaN(target) && Math.abs(n - target) < 1e-9;
  }
  return false;
}

function pass(maxPoints: number, feedback: string, gradingMode: string): GradingResult {
  return {
    score: maxPoints,
    maxPoints,
    isCorrect: true,
    feedback,
    gradingMode,
    llmConfidence: null,
    partialCreditApplied: false,
  };
}

function fail(maxPoints: number, feedback: string): GradingResult {
  return {
    score: 0,
    maxPoints,
    isCorrect: false,
    feedback,
    gradingMode: "failed",
    llmConfidence: null,
    partialCreditApplied: false,
  };
}

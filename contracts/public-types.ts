import type { QuestionType } from "./types";

/**
 * Question telle qu'exposée au client élève.
 * CRITIQUE : ne contient pas `correctAnswer`, ni `gradingRubric`.
 */
export interface PublicQuestion {
  id: number;
  type: QuestionType;
  question: string;
  options: string[] | null;
  justificationRequired: boolean;
  points: number;
  order: number;
  imageUrl: string | null;
}

/**
 * Informations publiques d'une évaluation exposées à l'élève avant démarrage.
 * CRITIQUE : ne contient pas les questions, ni les réponses.
 */
export interface PublicEvaluationInfo {
  id: number;
  title: string;
  description: string | null;
  duration: number;
  questionCount: number;
  maxScore: number;
}

/**
 * Résultat de soumission renvoyé à l'élève (sans correctAnswer).
 */
export interface PublicSubmitResult {
  sessionId: number;
  totalScore: number;
  maxScore: number;
  normalizedScore: number;
  resultsToken: string;
}

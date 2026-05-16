import type { GradingRubric } from "./grading-rubric";

export type QuestionType = "qcm" | "short_answer" | "true_false";

export interface EvaluationQuestion {
  id: number;
  type: QuestionType;
  question: string;
  options?: string[];
  correctAnswer: string;
  justificationRequired?: boolean;
  points: number;
  order: number;
  imageUrl?: string;
  // Phase 2 : rubric pédagogique — JAMAIS exposée au client
  gradingRubric?: GradingRubric;
  tags?: string[];
  difficulty?: 1 | 2 | 3; // 1=facile, 2=moyen, 3=difficile
}

export interface StudentAnswer {
  questionId: number;
  answer: string;
  justification?: string;
}

export interface CheatEvent {
  type: "tab_switch" | "blur" | "context_menu" | "copy" | "paste" | "fullscreen_exit" | "print";
  timestamp: string;
}

export interface SessionData {
  id: number;
  studentName: string;
  startedAt: Date;
  status: string;
  tabSwitchCount: number;
  totalScore?: number;
  maxScore?: number;
  timeSpent?: number;
}

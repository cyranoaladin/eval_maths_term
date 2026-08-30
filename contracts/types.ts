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

export interface CheatEvent {
  type:
    | "tab_switch" | "blur" | "context_menu" | "copy" | "paste"
    | "fullscreen_exit" | "print" | "devtools_open"
    | "fingerprint_mismatch" | "multi_device" | "prolonged_blur"
    | "idle_disconnect" | "window_size_anomaly";
  timestamp: string;
}

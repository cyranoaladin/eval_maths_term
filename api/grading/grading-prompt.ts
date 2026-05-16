/**
 * api/grading/grading-prompt.ts
 *
 * Templates de prompts pour la correction LLM.
 * Un seul format de réponse JSON est attendu quel que soit le type de question.
 */

export interface GradingPromptArgs {
  question: string;
  expectedAnswer: string;
  studentAnswer: string;
  justification?: string;
  questionType: "qcm" | "short_answer" | "true_false";
  maxPoints: number;
  detailedRubric: string;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

const SYSTEM_PROMPT = `Tu es un correcteur de mathématiques pour la classe de Terminale (programme français).
Tu dois corriger une réponse d'élève selon la rubrique fournie.

Réponds UNIQUEMENT en JSON valide, sans texte avant ni après, sans balises \`\`\`json.
Format attendu :
{
  "score": <nombre entre 0 et maxPoints, arrondi au demi-point>,
  "feedback": "<explication courte (1-3 phrases max), bienveillante, en français>",
  "confidence": <nombre entre 0 et 1>,
  "issues": ["calcul" | "justification" | "notation" | "domaine" | "rédaction"]
}

Règles :
- Sois juste mais pédagogue.
- Score 0 uniquement si la réponse est vide, hors-sujet ou manifestement fausse.
- Pour les vrai/faux : 1 pt pour la réponse correcte, 1 pt pour la justification valide.
- Ne pénalise pas la notation non-standard si le sens est correct.
- Ne donne JAMAIS la réponse correcte dans ton feedback (élève pourrait en profiter).`;

function buildQuestionBlock(args: GradingPromptArgs): string {
  const parts: string[] = [
    `**Type de question** : ${args.questionType}`,
    `**Énoncé** : ${args.question}`,
    `**Barème** : ${args.maxPoints} point${args.maxPoints > 1 ? "s" : ""}`,
    `**Rubrique de correction** :\n${args.detailedRubric}`,
    `---`,
    `**Réponse de l'élève** : ${args.studentAnswer || "(vide)"}`,
  ];

  if (args.justification) {
    parts.push(`**Justification de l'élève** : ${args.justification}`);
  }

  parts.push(
    `---`,
    `Corrige cette réponse selon la rubrique. maxPoints = ${args.maxPoints}.`,
  );

  return parts.join("\n");
}

export function buildGradingPrompt(args: GradingPromptArgs): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildQuestionBlock(args) },
  ];
}

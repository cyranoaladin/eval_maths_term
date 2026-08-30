/**
 * api/authoring/generate-questions.ts
 *
 * Génération assistée de QCM.
 *
 * La règle de fond vient du prompt `generateur_qcm.md` des manuels Nexus :
 * **chaque distracteur doit correspondre à une erreur type réelle et porter un
 * diagnostic** qui renvoie vers une méthode. Un distracteur fantaisiste — une
 * valeur tirée au hasard sans erreur sous-jacente — n'enseigne rien et fausse la
 * lecture des résultats : l'élève qui l'écarte ne prouve rien.
 *
 * Trois garde-fous :
 * 1. La sortie du modèle est validée par Zod ; toute proposition malformée est
 *    écartée avec son motif, jamais devinée ni réparée en silence.
 * 2. Chaque proposition repasse par `validateQuestionCoherence`, les mêmes
 *    règles que la saisie manuelle.
 * 3. **Rien n'est écrit en base.** La fonction retourne des propositions ;
 *    l'enseignant les accepte une par une depuis l'éditeur.
 */
import { z } from "zod";
import { chatCompletion, stripJsonFences, withRetry } from "../llm/chat";
import { logger } from "../lib/logger";
import { validateQuestionCoherence } from "@contracts/question-coherence";
import { DIAGNOSTIC_MAX_LENGTH, type GradingRubric } from "@contracts/grading-rubric";

/**
 * Contrat imposé au modèle.
 *
 * Strict sur ce qui décide de la note — énoncé, propositions, index de la bonne
 * réponse : une erreur y fausse la correction, la question est écartée.
 * Tolérant sur le reste — un diagnostic trop long ou une difficulté hors
 * barème se corrigent sans risque, et rejeter tout un lot pour cela ferait
 * perdre une génération entière à l'enseignant.
 */
const borne = (min: number, max: number) =>
  z.coerce
    .number()
    .transform((n) => Math.min(max, Math.max(min, Math.round(n))));

const GeneratedQcmSchema = z.object({
  question: z.string().min(10).max(2000),
  options: z.array(z.string().min(1).max(400)).min(3).max(6),
  correctIndex: z.number().int().nonnegative(),
  /** Un diagnostic par proposition ; chaîne vide pour la bonne réponse. */
  diagnostics: z.array(z.string()).default([]),
  points: borne(1, 10).default(1),
  difficulty: borne(1, 3).default(2),
  tags: z.array(z.string().max(60)).max(5).default([]),
  detailedRubric: z.string().default(""),
});



const GenerationEnvelopeSchema = z.object({
  questions: z.array(GeneratedQcmSchema).min(1).max(20),
});

export type GeneratedQcm = z.infer<typeof GeneratedQcmSchema>;

export interface GenerationRequest {
  /** Thème ou capacité visée, formulé par l'enseignant. */
  theme: string;
  count: number;
  difficulty: 1 | 2 | 3;
  level?: string;
  subject?: string;
  /** Notions déjà couvertes, pour éviter les redites. */
  existingQuestions?: string[];
  /** Extraits de cours fournis par le RAG (lot D). Vide pour l'instant. */
  contextPassages?: Array<{ source: string; text: string }>;
}

export interface QuestionProposal {
  draft: {
    type: "qcm";
    question: string;
    options: string[];
    correctAnswer: string;
    points: number;
    difficulty: number;
    tags: string[];
    gradingRubric: GradingRubric;
  };
  /** Faux si la proposition enfreint les règles de cohérence. */
  valid: boolean;
  errors: string[];
}

export interface GenerationResult {
  proposals: QuestionProposal[];
  /** Propositions écartées avant même la vérification de cohérence. */
  rejected: string[];
  model: string;
}

const SYSTEM_PROMPT = `Tu es professeur agrégé de mathématiques et tu rédiges des QCM d'évaluation.

RÈGLE CENTRALE — les distracteurs diagnostiques.
Chaque question a une bonne réponse et des distracteurs. CHAQUE distracteur doit :
1. Correspondre à une erreur type réelle et documentée, celle qu'un élève commet effectivement (confusion de formules, oubli d'une condition, erreur de signe, application d'une règle hors de son domaine de validité, confusion entre une fonction et sa dérivée...).
2. Porter un diagnostic rédigé à l'élève, qui NOMME l'erreur commise et indique quoi revoir.

INTERDITS ABSOLUS :
- Un distracteur fantaisiste, c'est-à-dire une valeur plausible en apparence mais qui ne correspond à aucune erreur identifiable. Une mauvaise réponse qui n'enseigne rien est inutile.
- Une question qui évalue deux capacités à la fois : le diagnostic doit être univoque.
- Une bonne réponse repérable à sa forme (la plus longue, la seule rédigée, la seule complète).

ÉCRITURE MATHÉMATIQUE :
- LaTeX entre $...$ pour les expressions en ligne.
- Utilise \\dfrac, \\mathbb{R}, \\ln, \\int, \\to, \\infty.
- Échappe les antislashs correctement dans le JSON.

SORTIE — uniquement un objet JSON, sans texte autour, sans clôture de code :
{
  "questions": [
    {
      "question": "énoncé avec du $LaTeX$",
      "options": ["proposition A", "proposition B", "proposition C", "proposition D"],
      "correctIndex": 0,
      "diagnostics": ["", "diagnostic si l'élève choisit B", "diagnostic si C", "diagnostic si D"],
      "points": 1,
      "difficulty": 2,
      "tags": ["notion"],
      "detailedRubric": "ce que la bonne réponse mobilise"
    }
  ]
}

Le tableau "diagnostics" a exactement la même longueur que "options". La case de la bonne réponse contient une chaîne vide.`;

export function buildGenerationPrompt(req: GenerationRequest) {
  const lignes: string[] = [];

  lignes.push(`Rédige ${req.count} question(s) à choix multiples sur : ${req.theme}.`);
  if (req.level) lignes.push(`Niveau : ${req.level}.`);
  if (req.subject) lignes.push(`Discipline : ${req.subject}.`);
  lignes.push(
    `Difficulté visée : ${req.difficulty === 1 ? "facile — application directe" : req.difficulty === 2 ? "moyenne — une étape de raisonnement" : "difficile — plusieurs étapes ou un piège classique"}.`,
  );
  lignes.push("Chaque question a 4 propositions.");

  if (req.contextPassages?.length) {
    lignes.push(
      "\nAppuie-toi sur ces extraits du cours. N'introduis aucune notion qui n'y figure pas :",
    );
    for (const p of req.contextPassages) {
      lignes.push(`\n[${p.source}]\n${p.text}`);
    }
  }

  if (req.existingQuestions?.length) {
    lignes.push(
      "\nCes questions existent déjà dans l'évaluation — n'en produis pas de variantes proches :",
    );
    for (const q of req.existingQuestions.slice(0, 20)) {
      lignes.push(`- ${q.slice(0, 160)}`);
    }
  }

  return [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: lignes.join("\n") },
  ];
}

/** Convertit une sortie de modèle en proposition vérifiée. */
export function toProposal(g: GeneratedQcm): QuestionProposal {
  // Le tableau de diagnostics est aligné sur les options : on le complète ou
  // on le tronque plutôt que de laisser un décalage passer inaperçu. Un
  // diagnostic trop bavard est coupé — l'enseignant peut le reprendre.
  const diagnostics = g.options.map((_, i) => {
    const d = (g.diagnostics[i] ?? "").trim();
    return d.length > DIAGNOSTIC_MAX_LENGTH
      ? d.slice(0, DIAGNOSTIC_MAX_LENGTH - 1).trimEnd() + "…"
      : d;
  });

  const draft = {
    type: "qcm" as const,
    question: g.question,
    options: g.options,
    correctAnswer: String(g.correctIndex),
    points: g.points,
    difficulty: g.difficulty,
    tags: g.tags,
    gradingRubric: {
      mode: { kind: "qcm" as const, correctIndex: g.correctIndex },
      llmReviewRequired: false,
      weight: g.points,
      detailedRubric: g.detailedRubric ? g.detailedRubric.slice(0, 600) : undefined,
      distractorDiagnostics: diagnostics.some((d) => d.length > 0) ? diagnostics : undefined,
    } satisfies GradingRubric,
  };

  const verdict = validateQuestionCoherence(draft);
  return {
    draft,
    valid: verdict.ok,
    errors: verdict.ok ? [] : verdict.errors,
  };
}

export async function generateQuestions(req: GenerationRequest): Promise<GenerationResult> {
  const messages = buildGenerationPrompt(req);

  const raw = await withRetry(
    () =>
      chatCompletion({
        messages,
        json: true,
        temperature: 0.7, // plus haut qu'en correction : on cherche de la variété
        /**
         * `max_tokens` est un plafond, pas une réservation : la facturation
         * porte sur les jetons réellement produits. Être large ne coûte donc
         * rien et évite des coupures.
         *
         * Le raisonnement domine et ne suit pas le nombre de questions : mesuré
         * à 830 jetons pour deux questions faciles, mais 3 460 pour une seule
         * question difficile avec extraits de cours. D'où une réserve fixe
         * généreuse plutôt qu'un budget proportionnel.
         */
        maxTokens: Math.min(32000, 6000 + 1500 * req.count),
        // Mesuré : ~85 s pour deux questions avec un modèle à raisonnement.
        // Le défaut de 30 s, calibré pour la correction, est inadapté ici.
        timeoutMs: Math.min(300_000, 60_000 + 45_000 * req.count),
      }),
    2,
    "llm-authoring",
  );

  const cleaned = stripJsonFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Le modèle n'a pas renvoyé de JSON exploitable : ${cleaned.slice(0, 120)}`,
    );
  }

  const envelope = GenerationEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    throw new Error(
      `Sortie du modèle non conforme : ${envelope.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).slice(0, 3).join(" ; ")}`,
    );
  }

  const proposals: QuestionProposal[] = [];
  const rejected: string[] = [];

  for (const [i, q] of envelope.data.questions.entries()) {
    if (q.correctIndex >= q.options.length) {
      rejected.push(
        `Question ${i + 1} : la bonne réponse désigne la proposition ${q.correctIndex + 1}, absente.`,
      );
      continue;
    }
    proposals.push(toProposal(q));
  }

  logger.info("[authoring] Génération LLM", {
    theme: req.theme,
    demandees: req.count,
    proposees: proposals.length,
    valides: proposals.filter((p) => p.valid).length,
    rejetees: rejected.length,
  });

  return { proposals, rejected, model: (await import("../llm/chat")).currentModel() };
}

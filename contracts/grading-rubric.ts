/**
 * contracts/grading-rubric.ts
 *
 * Types de rubric de correction — SERVEUR UNIQUEMENT.
 * Ne jamais exporter depuis public-types.ts ni renvoyer à un client élève.
 * Seules les routes teacherQuery peuvent y accéder.
 */
import { z } from "zod";

export const ComparisonModeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact") }),
  z.object({
    kind: z.literal("qcm"),
    correctIndex: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("true_false"),
    correctValue: z.enum(["true", "false"]),
  }),
  z.object({
    kind: z.literal("symbolic"),
    canonical: z.string(),
    variables: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("numeric"),
    value: z.number(),
    tolerance: z.number().nonnegative(),
    relative: z.boolean(),
  }),
  z.object({
    kind: z.literal("fraction"),
    numerator: z.number().int(),
    denominator: z.number().int().positive(),
    reduced: z.boolean(),
  }),
  z.object({
    kind: z.literal("set"),
    values: z.array(z.string()),
    ordered: z.boolean(),
  }),
]);

export const PartialCreditRuleSchema = z.object({
  rule: z.string(),
  score: z.number().nonnegative(),
  matcherKind: z.enum(["regex", "fractionEquivalent", "numericApprox"]),
  pattern: z.string().optional(),
  target: z.unknown().optional(),
});

/**
 * Longueur maximale d'un diagnostic de distracteur.
 * Source unique : le générateur tronque à cette valeur, le schéma la fait
 * respecter. Deux limites distinctes rendaient invalides les propositions
 * tombant entre les deux.
 */
export const DIAGNOSTIC_MAX_LENGTH = 600;

export const GradingRubricSchema = z.object({
  mode: ComparisonModeSchema,
  /**
   * QCM : diagnostic attaché à chaque proposition, aligné sur l'index des
   * options. Une mauvaise réponse doit enseigner quelque chose — l'élève lit
   * l'erreur type dans laquelle il est tombé plutôt qu'un « Réponse incorrecte ».
   * Case vide ou absente : retour générique.
   */
  distractorDiagnostics: z.array(z.string().max(DIAGNOSTIC_MAX_LENGTH)).optional(),
  acceptableForms: z.array(z.string()).optional(),
  rejectedPatterns: z.array(z.string()).optional(), // sources regex sérialisées
  partialCredit: z.array(PartialCreditRuleSchema).optional(),
  llmReviewRequired: z.boolean(),
  weight: z.number().positive(),
  detailedRubric: z.string().optional(),
});

export type ComparisonMode = z.infer<typeof ComparisonModeSchema>;
export type GradingRubric = z.infer<typeof GradingRubricSchema>;
export type PartialCreditRule = z.infer<typeof PartialCreditRuleSchema>;

/**
 * Question enrichie côté serveur (avec rubric).
 * Jamais transmise au client.
 */
export interface ServerQuestion {
  id: number;
  type: "qcm" | "short_answer" | "true_false";
  question: string;
  options: string[] | null;
  correctAnswer: string;
  justificationRequired: boolean;
  points: number;
  order: number;
  imageUrl: string | null;
  tags: string[] | null;
  difficulty: number | null;
  gradingRubric: GradingRubric | null;
}

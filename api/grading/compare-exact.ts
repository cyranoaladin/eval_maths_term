/**
 * api/grading/compare-exact.ts
 *
 * Comparaison littérale après normalisation.
 * Utilisée en premier dans la cascade — la plus rapide.
 */
import { normalizeExpression } from "./normalize";

export interface ExactResult {
  equal: boolean;
  reason: string;
}

export function compareExact(expected: string, given: string): ExactResult {
  const exp = normalizeExpression(expected);
  const gvn = normalizeExpression(given);

  if (exp === gvn) {
    return { equal: true, reason: "Égalité littérale après normalisation" };
  }

  // Tentative supplémentaire : suppression des parenthèses externes superflues
  const unwrap = (s: string) => s.replace(/^\((.+)\)$/, "$1");
  if (unwrap(exp) === unwrap(gvn)) {
    return { equal: true, reason: "Égalité après suppression parenthèses externes" };
  }

  return {
    equal: false,
    reason: `Formes normalisées différentes : attendu "${exp}", obtenu "${gvn}"`,
  };
}

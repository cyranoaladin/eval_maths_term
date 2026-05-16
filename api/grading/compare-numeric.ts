/**
 * api/grading/compare-numeric.ts
 *
 * Comparaison de valeurs numériques scalaires avec tolérance absolue ou relative.
 * Utilisée pour les limites, intégrales, probabilités (Q11, Q13, Q15).
 */
import { normalizeExpression } from "./normalize";

export interface NumericResult {
  equal: boolean;
  reason: string;
  parsedValue?: number;
}

/**
 * Parse une expression normalisée en nombre.
 * Supporte les formes : "2", "2.0", "0.53125", "ln(2)", "pi", "sqrt(2)", etc.
 * Pour les expressions avec fonctions, utilise une évaluation sécurisée simple.
 */
function parseNumericSafe(expr: string): number | null {
  const normalized = normalizeExpression(expr);

  // Cas simples : nombre pur
  const simple = parseFloat(normalized.replace(",", "."));
  if (!isNaN(simple) && /^[+-]?\d*\.?\d+([eE][+-]?\d+)?$/.test(normalized)) {
    return simple;
  }

  // Constantes connues
  if (normalized === "pi") return Math.PI;
  if (normalized === "e") return Math.E;
  if (normalized === "infinity" || normalized === "+infinity") return Infinity;
  if (normalized === "-infinity") return -Infinity;

  // log(2) = ln(2)
  if (normalized === "log(2)") return Math.LN2;
  if (normalized === "log(3)") return Math.log(3);
  if (normalized === "log(5)") return Math.log(5);
  if (normalized === "log(10)") return Math.log(10);
  if (normalized === "log10(10)") return 1;
  if (normalized === "2*log(2)" || normalized === "log(4)") return Math.log(4);

  // sqrt
  const sqrtMatch = normalized.match(/^sqrt\((\d+(?:\.\d+)?)\)$/);
  if (sqrtMatch) return Math.sqrt(parseFloat(sqrtMatch[1]));

  // Fraction simple p/q
  const fracMatch = normalized.match(/^(-?\d+)\*?\/\*?(\d+)$/) ??
    normalized.match(/^\((-?\d+)\)\/\((\d+)\)$/);
  if (fracMatch) {
    const num = parseInt(fracMatch[1], 10);
    const den = parseInt(fracMatch[2], 10);
    if (den !== 0) return num / den;
  }

  return null;
}

export function compareNumeric(
  expected: { value: number; tolerance: number; relative: boolean },
  given: string,
): NumericResult {
  const parsed = parseNumericSafe(given);

  if (parsed === null) {
    return {
      equal: false,
      reason: `Impossible de convertir "${given}" en valeur numérique`,
    };
  }

  if (!isFinite(parsed)) {
    return {
      equal: false,
      reason: `Valeur non finie obtenue : ${parsed}`,
      parsedValue: parsed,
    };
  }

  const diff = Math.abs(parsed - expected.value);
  const threshold = expected.relative
    ? expected.tolerance * Math.abs(expected.value)
    : expected.tolerance;

  if (diff <= threshold) {
    return {
      equal: true,
      reason: `Valeur correcte (|${parsed} − ${expected.value}| = ${diff.toExponential(2)} ≤ ${threshold.toExponential(2)})`,
      parsedValue: parsed,
    };
  }

  return {
    equal: false,
    reason: `Valeur incorrecte : obtenu ${parsed}, attendu ${expected.value} (écart ${diff.toExponential(2)})`,
    parsedValue: parsed,
  };
}

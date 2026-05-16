/**
 * api/grading/compare-fraction.ts
 *
 * Comparaison de fractions avec vérification d'irréductibilité.
 * Pénalité 25 % si fraction équivalente mais non réduite, ou valeur décimale exacte.
 */

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b > 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

interface FractionParsed {
  num: number;
  den: number;
}

function parseFraction(s: string): FractionParsed | null {
  const cleaned = s.replace(/\s+/g, "");
  // Formats : 17/32, -17/32, (17)/(32), \frac{17}{32}
  const patterns = [
    /^(-?\d+)\/(\d+)$/,
    /^\((-?\d+)\)\/\((\d+)\)$/,
    /^\\d?frac\{(-?\d+)\}\{(\d+)\}$/,
  ];
  for (const pat of patterns) {
    const m = cleaned.match(pat);
    if (m) {
      const num = parseInt(m[1], 10);
      const den = parseInt(m[2], 10);
      if (den === 0) return null;
      return { num, den };
    }
  }
  return null;
}

function parseDecimalFR(s: string): number | null {
  const cleaned = s.replace(/\s+/g, "").replace(",", ".");
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : null;
}

export interface FractionResult {
  equal: boolean;
  reason: string;
  penalty: number; // 0 = plein, 0.25 = 25% de pénalité
}

export function compareFraction(
  expected: { numerator: number; denominator: number; reduced: boolean },
  given: string,
): FractionResult {
  const expVal = expected.numerator / expected.denominator;

  // 1. Forme fraction
  const frac = parseFraction(given);
  if (frac) {
    if (frac.den === 0) {
      return { equal: false, reason: "Division par zéro", penalty: 0 };
    }
    const givenVal = frac.num / frac.den;
    if (Math.abs(givenVal - expVal) > 1e-12) {
      return { equal: false, reason: `Valeur incorrecte : ${frac.num}/${frac.den} ≠ ${expected.numerator}/${expected.denominator}`, penalty: 0 };
    }
    // Valeur correcte — vérifier irréductibilité
    if (expected.reduced) {
      const g = gcd(Math.abs(frac.num), frac.den);
      if (g !== 1) {
        const reduced = `${frac.num / g}/${frac.den / g}`;
        return {
          equal: true,
          reason: `Fraction équivalente mais non irréductible (PGCD = ${g}). Forme réduite attendue : ${reduced}.`,
          penalty: 0.25,
        };
      }
    }
    return { equal: true, reason: "Fraction correcte et irréductible", penalty: 0 };
  }

  // 2. Forme décimale
  const dec = parseDecimalFR(given);
  if (dec !== null) {
    if (Math.abs(dec - expVal) > 1e-9) {
      return { equal: false, reason: `Valeur décimale incorrecte : ${dec} ≠ ${expVal}`, penalty: 0 };
    }
    return {
      equal: true,
      reason: `Valeur correcte mais sous forme décimale (attendu : fraction irréductible ${expected.numerator}/${expected.denominator}).`,
      penalty: 0.25,
    };
  }

  return {
    equal: false,
    reason: `Format non reconnu pour "${given}" — attendu : fraction p/q ou décimal`,
    penalty: 0,
  };
}

/**
 * Applique la pénalité au score maximal.
 * Arrondi au demi-point (pratique française).
 */
export function applyFractionPenalty(maxPoints: number, penalty: number): number {
  return Math.round(maxPoints * (1 - penalty) * 2) / 2;
}

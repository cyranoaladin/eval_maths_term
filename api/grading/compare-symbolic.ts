/**
 * api/grading/compare-symbolic.ts
 *
 * Comparaison symbolique en 3 passes :
 *   1. Égalité littérale après normalisation
 *   2. Simplification symbolique via mathjs (diff → 0)
 *   3. Test numérique sur 20 points pseudo-aléatoires
 *
 * Pièges gérés :
 * - mathjs.simplify throw sur expressions exotiques → try/catch
 * - mathjs peut retourner BigNumber → forcer { number: "number" }
 * - Domaine des variables : éviter 0 et entiers exacts pour les log/racines
 * - Expressions trop longues → guard anti-DoS (200 chars)
 */
import { create, all } from "mathjs";
import type { ConfigOptions } from "mathjs";
import { normalizeExpression } from "./normalize";

const math = create(all, { number: "number" } satisfies ConfigOptions);

export interface SymbolicResult {
  equal: boolean;
  reason: string;
  strategy: "literal" | "simplify" | "numeric" | "failed";
}

/** Plages sûres pour chaque variable — évite les singularités log/sqrt */
const SAFE_RANGE_BASE = 0.5; // min > 0 pour log
const SAFE_RANGE_AMPLITUDE = 3;

function safeScopeValue(i: number, varIndex: number): number {
  // Valeurs irrationnelles pour éviter les faux positifs sur des coïncidences entières
  return SAFE_RANGE_BASE + ((i * 1.618 + varIndex * 2.718) % SAFE_RANGE_AMPLITUDE) + 0.137;
}

export async function areSymbolicallyEqual(
  expected: string,
  given: string,
  variables: string[],
): Promise<SymbolicResult> {
  const exp = normalizeExpression(expected);
  const gvn = normalizeExpression(given);

  // Garde-fou DoS
  if (gvn.length > 200) {
    return { equal: false, reason: "Réponse trop longue (> 200 caractères après normalisation)", strategy: "failed" };
  }

  // Passe 1 : égalité littérale
  if (exp === gvn) {
    return { equal: true, reason: "Égalité littérale après normalisation", strategy: "literal" };
  }

  // Passe 2 : simplification symbolique
  try {
    const diff = math.simplify(`(${exp}) - (${gvn})`);
    const diffStr = diff.toString().replace(/\s/g, "");
    if (diffStr === "0" || diffStr === "0.0" || diffStr === "0n") {
      return { equal: true, reason: "Différence symbolique simplifiée à 0", strategy: "simplify" };
    }
  } catch {
    // Expression non simplifiable — passe au test numérique
  }

  // Passe 3 : test numérique sur 20 points
  // Accepte un unique désaccord (peut être une singularité numérique) — bloque sur ≥ 2
  let mismatches = 0;
  for (let i = 0; i < 20; i++) {
    const scope: Record<string, number> = {};
    variables.forEach((v, idx) => {
      scope[v] = safeScopeValue(i, idx);
    });

    try {
      const a = math.evaluate(exp, scope);
      const b = math.evaluate(gvn, scope);

      if (typeof a !== "number" || typeof b !== "number") {
        return { equal: false, reason: `Évaluation numérique non scalaire au point ${i}`, strategy: "failed" };
      }
      if (isNaN(a) || isNaN(b)) {
        return { equal: false, reason: `NaN obtenu à l'évaluation (point ${i}, scope: ${JSON.stringify(scope)})`, strategy: "failed" };
      }

      // Tolérance relative pour les grandes valeurs (ex: exp(x) peut valoir 10^6)
      const tol = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
      if (Math.abs(a - b) > tol) {
        mismatches++;
        if (mismatches >= 2) {
          return {
            equal: false,
            reason: `Désaccord numérique (${mismatches} points) : ex. scope=${JSON.stringify(scope)} → attendu ${a}, obtenu ${b}`,
            strategy: "numeric",
          };
        }
      }
    } catch (e) {
      return {
        equal: false,
        reason: `Erreur d'évaluation au point ${i} : ${String(e)}`,
        strategy: "failed",
      };
    }
  }

  return {
    equal: true,
    reason: `Égalité numérique vérifiée sur 20 points (${mismatches} désaccord${mismatches === 1 ? " toléré" : "s"})`,
    strategy: "numeric",
  };
}

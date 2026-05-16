/**
 * api/grading/compare-set.ts
 *
 * Comparaison d'ensembles de valeurs — ordonné ou non ordonné.
 * Utilisé pour les questions demandant "l'ensemble des solutions".
 */
import { normalizeExpression } from "./normalize";
import { compareExact } from "./compare-exact";

export interface SetResult {
  equal: boolean;
  reason: string;
  missing?: string[];
  extra?: string[];
}

/**
 * Parse une réponse sous forme d'ensemble :
 * "{1, 2, 3}", "[1; 2; 3]", "1, 2, 3", "∅", "{}", "empty"
 */
function parseSet(s: string): string[] | null {
  const trimmed = s.trim();

  // Ensemble vide
  if (
    trimmed === "∅" ||
    trimmed === "{}" ||
    trimmed.toLowerCase() === "empty" ||
    trimmed.toLowerCase() === "vide" ||
    trimmed === "∅"
  ) {
    return [];
  }

  // Supprime les délimiteurs { }, [ ], ( )
  const inner = trimmed.replace(/^[{[(]/, "").replace(/[}\])]$/, "").trim();
  if (!inner) return [];

  // Split sur virgule ou point-virgule
  const parts = inner.split(/[;,]/).map((p) => p.trim()).filter(Boolean);
  return parts;
}

export function compareSet(
  expected: { values: string[]; ordered: boolean },
  given: string,
): SetResult {
  const givenValues = parseSet(given);

  if (givenValues === null) {
    return { equal: false, reason: `Format non reconnu pour l'ensemble : "${given}"` };
  }

  // Normaliser toutes les valeurs
  const normExpected = expected.values.map(normalizeExpression);
  const normGiven = givenValues.map(normalizeExpression);

  if (expected.ordered) {
    // Comparaison ordonnée : chaque position doit correspondre
    if (normExpected.length !== normGiven.length) {
      return {
        equal: false,
        reason: `Nombre d'éléments incorrect : attendu ${normExpected.length}, obtenu ${normGiven.length}`,
      };
    }
    for (let i = 0; i < normExpected.length; i++) {
      const res = compareExact(normExpected[i], normGiven[i]);
      if (!res.equal) {
        return {
          equal: false,
          reason: `Élément ${i + 1} incorrect : attendu "${normExpected[i]}", obtenu "${normGiven[i]}"`,
        };
      }
    }
    return { equal: true, reason: "Ensemble ordonné correct" };
  }

  // Comparaison non ordonnée : même multiensemble
  const missing: string[] = [];
  const extra: string[] = [];
  const remaining = [...normGiven];

  for (const exp of normExpected) {
    const idx = remaining.findIndex((g) => compareExact(exp, g).equal);
    if (idx === -1) {
      missing.push(exp);
    } else {
      remaining.splice(idx, 1);
    }
  }
  extra.push(...remaining);

  if (missing.length === 0 && extra.length === 0) {
    return { equal: true, reason: "Ensemble non ordonné correct" };
  }

  return {
    equal: false,
    reason: `Ensemble incorrect${missing.length ? ` — manquants : [${missing.join(", ")}]` : ""}${extra.length ? ` — en trop : [${extra.join(", ")}]` : ""}`,
    missing,
    extra,
  };
}

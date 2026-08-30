/**
 * api/grading/compare-set.ts
 *
 * Comparaison d'ensembles de valeurs — ordonné ou non ordonné.
 * Utilisé pour les questions demandant "l'ensemble des solutions".
 */
import { normalizeExpression } from "./normalize";
import { compareExact } from "./compare-exact";
import { evaluate } from "mathjs";

/**
 * Valeur numérique d'un élément d'ensemble, ou `null` s'il n'en a pas.
 *
 * `1/2` et `((1)/(2))` désignent le même nombre mais ne sont pas la même
 * chaîne : un élève écrivant sa solution en fraction dans le champ
 * mathématique serait compté faux face à un barème écrit « 1/2 ». La
 * comparaison de chaînes reste la règle — c'est elle qui décide pour tout ce
 * qui n'est pas un nombre — et on ne lui ajoute qu'un secours : deux constantes
 * qui valent le même nombre sont le même élément.
 */
function valeurNumerique(element: string): number | null {
  try {
    const v = evaluate(element);
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Deux éléments désignent-ils la même valeur ? */
function memeElement(attendu: string, donne: string): boolean {
  if (compareExact(attendu, donne).equal) return true;
  const a = valeurNumerique(attendu);
  const b = valeurNumerique(donne);
  // Tolérance relative : les fractions décimales ne tombent pas juste en
  // binaire (0,1 + 0,2 n'est pas 0,3).
  return a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
}

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
function parseSet(s: string): string[] {
  // MathLive écrit les accolades d'un ensemble en délimiteurs extensibles
  // échappés : `\left\{1,2\right\}`. Sans cette remise à plat, le découpage
  // rendait « \left\{1 » et « 2\right\} », deux éléments qui ne
  // correspondaient à rien : un élève ayant donné le bon ensemble était compté
  // faux. On retire les habillages LaTeX sans toucher au contenu.
  const trimmed = s
    .replace(/\\left\s*/g, "")
    .replace(/\\right\s*/g, "")
    .replace(/\\([{}])/g, "$1")
    .trim();

  // Ensemble vide
  if (
    trimmed === "∅" ||
    trimmed === "{}" ||
    trimmed === "\\emptyset" ||
    trimmed === "\\varnothing" ||
    trimmed.toLowerCase() === "empty" ||
    trimmed.toLowerCase() === "vide"
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
  // `parseSet` rend toujours une liste — vide au pire. Le test d'échec qui
  // figurait ici ne pouvait pas se déclencher.
  const givenValues = parseSet(given);

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
      if (!memeElement(normExpected[i], normGiven[i])) {
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
    const idx = remaining.findIndex((g) => memeElement(exp, g));
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

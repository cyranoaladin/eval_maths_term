/**
 * api/grading/input-mode.ts
 *
 * Quel clavier proposer à l'élève pour une réponse courte.
 *
 * Le mode de correction vit dans `gradingRubric`, qui ne sort jamais vers une
 * route élève. Mais imposer un clavier mathématique à une question dont la
 * réponse attendue est un mot dégrade la copie : l'élève se bat contre
 * l'éditeur de formules pour écrire « croissante ». On expose donc
 * **uniquement** la nature du champ à afficher — deux valeurs, rien du barème.
 *
 * Ce que cette information révèle : que la réponse est mathématique ou
 * textuelle. C'est déjà lisible dans l'énoncé. Elle ne dit ni la valeur
 * attendue, ni la tolérance, ni les formes acceptées.
 */
import type { GradingRubric } from "@contracts/grading-rubric";

/** Nature du champ de saisie proposé pour une réponse courte. */
export type InputMode = "math" | "text";

/**
 * `exact` est la seule comparaison réellement textuelle : elle confronte des
 * chaînes. Toutes les autres — numérique, fraction, symbolique, ensemble —
 * portent sur des objets mathématiques.
 *
 * Sans barème, on retient `math` : la plateforme est un outil de mathématiques
 * et le champ garde de toute façon son repli clavier.
 */
export function modeSaisie(rubric: GradingRubric | null | undefined): InputMode {
  return rubric?.mode.kind === "exact" ? "text" : "math";
}

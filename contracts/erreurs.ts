/**
 * contracts/erreurs.ts
 *
 * Le message d'une erreur, quoi qu'on nous ait jeté.
 *
 * Ce ternaire était écrit onze fois, avec onze replis différents — dont
 * plusieurs qu'aucun appel ne pouvait atteindre, puisque le code voisin ne
 * lève que des `Error`. Un seul endroit, éprouvé une fois.
 */
export function messageDErreur(e: unknown, repli?: string): string {
  if (e instanceof Error) return e.message;
  return repli ?? String(e);
}

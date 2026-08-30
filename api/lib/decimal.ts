/**
 * api/lib/decimal.ts
 *
 * MySQL renvoie les colonnes `DECIMAL` sous forme de chaînes : le pilote ne les
 * convertit pas, pour ne pas perdre de précision. Sans conversion explicite,
 * une note « 1.50 » se compare et s'additionne comme du texte.
 *
 * Les points sont décimaux parce que le moteur produit du crédit partiel :
 * une fraction non réduite vaut 75 % du barème, une justification à moitié
 * juste la moitié, et une note saisie à la main peut aller au quart de point.
 * Une colonne entière arrondissait tout cela en silence — une pénalité de 25 %
 * sur 2 points redonnait les 2 points.
 */

/** Convertit une valeur décimale de la base en nombre. */
export function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Idem, avec une valeur de repli. */
export function toNumberOr(v: string | number | null | undefined, defaut: number): number {
  return toNumber(v) ?? defaut;
}

/** Prépare un nombre pour une colonne décimale (Drizzle attend une chaîne). */
export function toDecimal(n: number): string {
  return n.toFixed(2);
}

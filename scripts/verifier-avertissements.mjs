/**
 * scripts/verifier-avertissements.mjs
 *
 * Aucun avertissement ne se perd dans le bruit.
 *
 * Une construction qui imprime six avertissements à chaque exécution finit par
 * en imprimer sept sans que personne ne le remarque. Ce contrôle lit les
 * journaux, retient les lignes d'avertissement, et échoue sur toute ligne qui
 * n'est pas nommée dans `security/avertissements-connus.json`.
 *
 * La liste ne masque rien : chaque entrée dit d'où vient l'avertissement, par
 * quelle chaîne de dépendances, pourquoi il subsiste et à quelle condition il
 * disparaîtra. Un avertissement nouveau ferme la porte.
 *
 *   node scripts/verifier-avertissements.mjs <journal> [journal...]
 */
import { readFile } from "node:fs/promises";

const journaux = process.argv.slice(2);
if (journaux.length === 0) {
  console.error("Usage : node scripts/verifier-avertissements.mjs <journal> [journal...]");
  process.exit(2);
}

const { connus } = JSON.parse(
  await readFile("security/avertissements-connus.json", "utf8"),
);

/*
  Ce qui compte comme un avertissement. Volontairement large : mieux vaut
  examiner une ligne de trop que d'en laisser passer une.

  `warning:` plutôt que `warn` seul, sinon le nom d'une image ou d'une branche
  contenant « warn » suffirait à déclencher — c'est arrivé pendant la mise au
  point de ce script, sur une image nommée `atelier-qcm:warn`.
*/
const SIGNATURES = [
  /\bnpm warn\b/,
  /\bwarning:/i,
  /^\s*\(!\)/,
  /\bDeprecationWarning\b/,
  /\bExperimentalWarning\b/,
  /\bis deprecated\b/i,
];

const estAvertissement = (ligne) => SIGNATURES.some((s) => s.test(ligne));

/** Retire l'horodatage et le préfixe d'étape que buildkit ajoute. */
const nettoyer = (ligne) =>
  ligne
    .replace(/^#\d+\s+[\d.]+\s+/, "")
    .replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s+/, "")
    .trim();

let inconnus = [];
let reconnus = 0;
let lignes = 0;

for (const journal of journaux) {
  let contenu;
  try {
    contenu = await readFile(journal, "utf8");
  } catch {
    console.error(`✗ journal illisible : ${journal}`);
    process.exit(2);
  }
  for (const brute of contenu.split("\n")) {
    lignes++;
    if (!estAvertissement(brute)) continue;
    const ligne = nettoyer(brute);
    const connu = connus.find((c) => ligne.includes(c.motif));
    if (connu) {
      reconnus++;
      continue;
    }
    inconnus.push({ journal, ligne });
  }
}

// Deux fois le même avertissement n'est qu'un avertissement.
const uniques = [...new Map(inconnus.map((i) => [i.ligne, i])).values()];

console.log(`  ${lignes} lignes examinées dans ${journaux.length} journal(aux)`);
console.log(`  ${reconnus} avertissements connus, ${uniques.length} inconnus`);

if (uniques.length > 0) {
  console.log("");
  console.log("Avertissements que personne n'a examinés :");
  for (const u of uniques) {
    console.log(`  ${u.journal} : ${u.ligne}`);
  }
  console.log("");
  console.log("  Corrigez-en la cause. Si elle n'est pas entre vos mains, décrivez-la");
  console.log("  dans security/avertissements-connus.json : origine, chaîne de");
  console.log("  dépendances, raison, et ce qui la fera disparaître.");
  console.log("");
  console.log("AVERTISSEMENTS = FAIL");
  process.exit(1);
}

console.log("");
console.log("AVERTISSEMENTS = PASS");

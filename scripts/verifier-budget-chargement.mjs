/**
 * scripts/verifier-budget-chargement.mjs
 *
 * Ce que le navigateur télécharge avant d'afficher quoi que ce soit.
 *
 * Rollup avertit quand un fichier dépasse 500 ko. C'est une heuristique
 * aveugle : elle range dans le même sac un fichier chargé à la demande et un
 * fichier imposé à chaque visiteur. MathLive pèse 828 ko et n'est chargé que
 * par qui saisit une formule ; un fichier de 450 ko imposé à tout élève ne
 * déclencherait rien du tout.
 *
 * Ce contrôle-ci mesure la seule chose qui compte pour un élève sur le réseau
 * d'un lycée : le poids du premier chargement. Il lit `index.html`, additionne
 * ce qui y est référencé, et vérifie que les bibliothèques lourdes n'y sont pas.
 *
 *   node scripts/verifier-budget-chargement.mjs [dossier]
 */
import { readFile, stat, readdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const racine = process.argv[2] ?? "dist/public";

/*
  Les budgets. Relevés le 31 août 2026, avec de la marge pour la respiration
  normale du code — pas assez pour qu'une bibliothèque entière s'y glisse sans
  qu'on le remarque.
*/
const BUDGET_GZIP_KO = 300;
const BUDGET_BRUT_KO = 1000;

/** Ce qui ne doit jamais être imposé au premier rendu. */
const CHARGEMENT_DIFFERE = ["mathlive", "vendor-katex"];

const html = await readFile(join(racine, "index.html"), "utf8");
const references = [...html.matchAll(/assets\/([A-Za-z0-9_.-]+\.js)/g)].map((m) => m[1]);
const uniques = [...new Set(references)].sort();

if (uniques.length === 0) {
  console.error("✗ Aucun module référencé par index.html — la construction a-t-elle abouti ?");
  process.exit(1);
}

let brut = 0;
let comprime = 0;
console.log("▶ Premier chargement");
for (const f of uniques) {
  const chemin = join(racine, "assets", f);
  const contenu = await readFile(chemin);
  const g = gzipSync(contenu).length;
  brut += contenu.length;
  comprime += g;
  console.log(`  ${f.padEnd(34)} ${(contenu.length / 1024).toFixed(1).padStart(8)} ko  gzip ${(g / 1024).toFixed(1).padStart(7)} ko`);
}

console.log("");
console.log(`PREMIER_CHARGEMENT_BRUT = ${(brut / 1024).toFixed(1)} ko  (budget ${BUDGET_BRUT_KO})`);
console.log(`PREMIER_CHARGEMENT_GZIP = ${(comprime / 1024).toFixed(1)} ko  (budget ${BUDGET_GZIP_KO})`);

let echecs = 0;
const grief = (m) => {
  console.log(`  ✗ ${m}`);
  echecs++;
};

if (comprime / 1024 > BUDGET_GZIP_KO) {
  grief(`le premier chargement dépasse le budget comprimé de ${(comprime / 1024 - BUDGET_GZIP_KO).toFixed(1)} ko`);
}
if (brut / 1024 > BUDGET_BRUT_KO) {
  grief(`le premier chargement dépasse le budget brut de ${(brut / 1024 - BUDGET_BRUT_KO).toFixed(1)} ko`);
}

for (const lourd of CHARGEMENT_DIFFERE) {
  const impose = uniques.find((f) => f.startsWith(lourd));
  if (impose) {
    grief(
      `« ${impose} » est imposé au premier rendu alors qu'il doit être chargé à la demande.\n` +
        `      Une entrée de manualChunks qui le nomme suffit à le faire retomber dans un fichier\n` +
        `      importé par la page d'accueil : c'est exactement ce qui était arrivé à MathLive.`,
    );
  }
}

// Et qu'ils existent bel et bien : un chargement différé qui a disparu du
// build ne se verrait pas autrement.
const fichiers = await readdir(join(racine, "assets"));
for (const lourd of CHARGEMENT_DIFFERE) {
  if (!fichiers.some((f) => f.startsWith(lourd) && f.endsWith(".js"))) {
    grief(`aucun fichier « ${lourd} » dans la construction : le découpage a changé`);
  }
}

console.log("");
if (echecs > 0) {
  console.log("BUDGET_CHARGEMENT = FAIL");
  process.exit(1);
}
console.log("BUDGET_CHARGEMENT = PASS");

/**
 * db/seed.ts — script CLI
 *
 * Usage : npx tsx db/seed.ts
 * La logique vit dans `seed-evaluation.ts`, partagée avec la route
 * `evaluation.seed` du dashboard enseignant.
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { messageDErreur } from "@contracts/erreurs";
import { seedEvaluation } from "./seed-evaluation";

/**
 * Rend un code de sortie plutôt que de le poser lui-même : le semis est
 * appelé par la recette de l'image, qui regarde ce code.
 */
export async function main(): Promise<number> {
  try {
    const { evaluationId, created, updated, total } = await seedEvaluation();
    console.log(`Évaluation ${evaluationId}`);
    console.log(`  questions créées : ${created} | mises à jour : ${updated} (total : ${total})`);
    return 0;
  } catch (err) {
    console.error("Semis échoué :", messageDErreur(err));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}

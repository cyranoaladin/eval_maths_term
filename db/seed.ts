/**
 * db/seed.ts — script CLI
 *
 * Usage : npx tsx db/seed.ts
 * La logique vit dans `seed-evaluation.ts`, partagée avec la route
 * `evaluation.seed` du dashboard enseignant.
 */
import "dotenv/config";
import { seedEvaluation } from "./seed-evaluation";

seedEvaluation()
  .then(({ evaluationId, created, updated, total }) => {
    console.log(`🌱 Évaluation ${evaluationId}`);
    console.log(`  ✚  Questions créées: ${created} | mises à jour: ${updated} (total: ${total})`);
    console.log("✅ Seed terminé.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Seed échoué :", err);
    process.exit(1);
  });

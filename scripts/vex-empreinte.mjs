/**
 * scripts/vex-empreinte.mjs
 *
 * L'empreinte du runtime dont dépendent les analyses VEX.
 *
 * Une preuve « non concerné » ne survit pas à un changement de runtime. Elle
 * dit qu'une fonction n'est jamais appelée *par ce code-là*, dans *cette
 * image-là*. Changez la recette de l'image, la version d'AMC, ou le code qui
 * pilote la composition, et la preuve doit être refaite.
 *
 * Cette empreinte rend ce lien mécanique : la CI la recalcule et refuse
 * l'attestation qui ne correspond plus.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** Ce dont dépendent les analyses. Rien de plus, rien de moins. */
export const SOURCES = [
  "Dockerfile",
  "api/paper/amc-runner.ts",
  "api/paper/amc-template.ts",
  "docs/DEPENDANCES.md",
];

export async function empreinteRuntime() {
  const h = createHash("sha256");
  for (const f of SOURCES) {
    h.update(f);
    h.update("\0");
    h.update(await readFile(f));
    h.update("\0");
  }
  return h.digest("hex");
}

if (process.argv[1]?.endsWith("vex-empreinte.mjs")) {
  console.log(await empreinteRuntime());
}

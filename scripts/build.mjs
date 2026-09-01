/**
 * scripts/build.mjs
 *
 * Produit l'artefact déployable : le bundle du navigateur, le serveur et le
 * migrateur.
 *
 * La construction inscrit dans le binaire la version et l'empreinte Git.
 * Sans elles, un exploitant devant une anomalie n'a aucun moyen de savoir ce
 * qui tourne : `docker compose ps` donne un identifiant d'image, pas un
 * commit. `/api/health` les rend lisibles.
 *
 * L'empreinte vient de `GIT_SHA` quand elle est fournie — c'est le cas dans
 * l'image Docker, où le dépôt n'est pas copié — sinon de `git` directement.
 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const paquet = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function empreinteGit() {
  if (process.env.GIT_SHA) return process.env.GIT_SHA.slice(0, 12);
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Ni variable ni dépôt : on le dit, plutôt que d'inventer une empreinte.
    return "inconnue";
  }
}

const VERSION = process.env.APP_VERSION ?? paquet.version;
const SHA = empreinteGit();

const definitions = {
  __VERSION_APPLICATION__: JSON.stringify(VERSION),
  __EMPREINTE_GIT__: JSON.stringify(SHA),
};

console.log(`Construction de ${paquet.name} ${VERSION} (${SHA})`);

// ── Navigateur ───────────────────────────────────────────────────────────────
// `--sans-navigateur` : seulement le serveur et le migrateur. C'est ce que le
// job CI des migrations utilise — il éprouve `node dist/migrate.js`, le
// migrateur réellement déployé, et n'a nul besoin du bundle du navigateur.
if (!process.argv.includes("--sans-navigateur")) {
  const vite = spawnSync("npx", ["vite", "build"], {
    stdio: "inherit",
    env: { ...process.env, APP_VERSION: VERSION, GIT_SHA: SHA },
  });
  if (vite.status !== 0) process.exit(vite.status ?? 1);
}

// ── Serveur et migrateur ─────────────────────────────────────────────────────
// `createRequire` est réinjecté : le bundle est en ESM, et pdfkit charge ses
// polices par `require`. Le nom est préfixé pour ne pas entrer en collision
// avec un `require` défini par une dépendance.
const banniere = {
  js:
    "import { createRequire as __creerRequire } from 'module';" +
    "const require = __creerRequire(import.meta.url);",
};

// `db/seed.ts` est bundlé comme le migrateur : l'image de production n'a plus
// de gestionnaire de paquets, et `npx tsx db/seed.ts` — la commande que la
// documentation donnait — ne peut plus y fonctionner.
for (const entree of ["api/boot.ts", "db/migrate.ts", "db/seed.ts"]) {
  await build({
    entryPoints: [entree],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: "dist",
    banner: banniere,
    define: definitions,
  });
}

console.log("Artefact prêt dans dist/.");

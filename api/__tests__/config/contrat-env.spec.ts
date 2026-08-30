/**
 * Un seul contrat de configuration.
 *
 * Quatre fichiers décrivent ce que l'application attend de son environnement :
 * le schéma de `api/lib/env.ts`, le modèle `.env.example`, le compose de
 * production et `DEPLOYMENT.md`. Rien ne les tenait ensemble — et ils avaient
 * divergé : le code retenait Moonshot comme fournisseur de correction assistée
 * pendant que le compose imposait OpenRouter, si bien que la même version de
 * l'application ne se comportait pas pareil selon qu'on la démarrait par npm ou
 * par Docker. `PAPER_OUTPUT_DIR`, de son côté, était lu directement dans
 * `process.env` sans figurer nulle part dans le contrat.
 *
 * Ce test lit les quatre fichiers et refuse qu'ils se contredisent.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RACINE = join(import.meta.dirname, "..", "..", "..");
const lire = (rel: string) => readFileSync(join(RACINE, rel), "utf8");

/** Variables déclarées dans le schéma zod, et lesquelles sont obligatoires. */
function schemaEnv(): { toutes: string[]; requises: string[] } {
  const source = lire("api/lib/env.ts");
  const debut = source.indexOf("const envSchema = z.object({");
  expect(debut, "envSchema introuvable dans api/lib/env.ts").toBeGreaterThan(-1);
  const corps = source.slice(debut, source.indexOf("\nfunction parseEnv()"));

  const toutes: string[] = [];
  const requises: string[] = [];
  // Une déclaration peut tenir sur plusieurs lignes : on découpe sur les
  // débuts de clé plutôt que sur les retours à la ligne.
  const morceaux = corps.split(/\n\s{2}(?=[A-Z][A-Z0-9_]*:\s*z\.)/);
  for (const morceau of morceaux) {
    const m = morceau.match(/^\s*([A-Z][A-Z0-9_]*):\s*z\./);
    if (!m) continue;
    const nom = m[1];
    toutes.push(nom);
    const declaration = morceau.split(/\n\s{2}\}/)[0];
    if (!/\.default\(|\.optional\(/.test(declaration)) requises.push(nom);
  }
  return { toutes, requises };
}

/** Variables citées dans `.env.example`, y compris celles laissées vides. */
function modeleEnv(): string[] {
  return lire(".env.example")
    .split("\n")
    .map((l) => l.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter((n): n is string => Boolean(n));
}

/** Variables que le navigateur reçoit, telles que le code les lit. */
function variablesNavigateur(): string[] {
  const trouvees = new Set<string>();
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier)) {
      const complet = join(dossier, entree);
      if (statSync(complet).isDirectory()) parcourir(complet);
      else if (/\.tsx?$/.test(entree)) {
        for (const m of readFileSync(complet, "utf8").matchAll(
          /import\.meta\.env\.(VITE_[A-Z0-9_]+)/g,
        )) {
          trouvees.add(m[1]);
        }
      }
    }
  };
  parcourir(join(RACINE, "src"));
  return [...trouvees];
}

/** Variables que le compose de production impose au conteneur applicatif. */
function environnementCompose(): string[] {
  const compose = lire("docker-compose.yml");
  const app = compose.slice(compose.indexOf("\n  app:"));
  const bloc = app.slice(app.indexOf("environment:"), app.indexOf("volumes:"));
  return bloc
    .split("\n")
    .map((l) => l.match(/^\s{6}([A-Z][A-Z0-9_]*):/)?.[1])
    .filter((n): n is string => Boolean(n));
}

const { toutes: SCHEMA, requises: REQUISES } = schemaEnv();
const MODELE = modeleEnv();

/** Variables du modèle qui ne s'adressent pas au serveur applicatif. */
const HORS_SERVEUR = (nom: string) =>
  nom.startsWith("VITE_") || nom.startsWith("MYSQL_") || nom === "TEST_DATABASE_URL";

describe("contrat de configuration", () => {
  it("lit effectivement les quatre fichiers", () => {
    expect(SCHEMA.length).toBeGreaterThan(20);
    expect(MODELE.length).toBeGreaterThan(20);
    expect(REQUISES.length).toBeGreaterThan(0);
  });

  it("documente dans .env.example chaque variable que le code lit", () => {
    const absentes = SCHEMA.filter((n) => !MODELE.includes(n));
    expect(
      absentes,
      `Ces variables sont lues par api/lib/env.ts sans figurer dans .env.example :\n${absentes.join("\n")}`,
    ).toEqual([]);
  });

  it("ne documente aucune variable serveur que le code ignore", () => {
    const inconnues = MODELE.filter((n) => !HORS_SERVEUR(n) && !SCHEMA.includes(n));
    expect(
      inconnues,
      `Ces variables figurent dans .env.example sans être lues :\n${inconnues.join("\n")}`,
    ).toEqual([]);
  });

  it("documente chaque variable exposée au navigateur", () => {
    const absentes = variablesNavigateur().filter((n) => !MODELE.includes(n));
    expect(absentes, `\n${absentes.join("\n")}`).toEqual([]);
  });

  it("ne laisse le compose imposer que la topologie du conteneur", () => {
    const impose = environnementCompose();
    // NODE_ENV, DATABASE_URL et PAPER_OUTPUT_DIR décrivent le conteneur, pas un
    // choix de l'exploitant : le reste vient de `.env`, sans intermédiaire.
    expect(impose.sort()).toEqual(["DATABASE_URL", "NODE_ENV", "PAPER_OUTPUT_DIR"]);
    const inconnues = impose.filter((n) => !SCHEMA.includes(n));
    expect(inconnues, `\n${inconnues.join("\n")}`).toEqual([]);
  });

  it("ne place aucune valeur par défaut dans le compose", () => {
    // `${VAR:-valeur}` crée un second jeu de défauts, invisible depuis le code.
    for (const fichier of ["docker-compose.yml", "docker-compose.dev.yml"]) {
      const defauts = lire(fichier)
        .split("\n")
        .filter((l) => /\$\{[A-Z][A-Z0-9_]*:-/.test(l));
      expect(
        defauts,
        `${fichier} propose des valeurs par défaut qui contredisent api/lib/env.ts :\n${defauts.join("\n")}`,
      ).toEqual([]);
    }
  });

  it("nomme dans DEPLOYMENT.md chaque variable obligatoire", () => {
    const doc = lire("DEPLOYMENT.md");
    const absentes = REQUISES.filter((n) => !doc.includes(n));
    expect(
      absentes,
      `Ces variables sont obligatoires sans être documentées dans DEPLOYMENT.md :\n${absentes.join("\n")}`,
    ).toEqual([]);
  });

  it("ne versionne aucun identifiant en clair", () => {
    const suspects: string[] = [];
    for (const fichier of [
      "docker-compose.yml",
      "docker-compose.dev.yml",
      ".env.example",
    ]) {
      lire(fichier)
        .split("\n")
        .forEach((ligne, i) => {
          const m = ligne.match(
            /^\s*-?\s*([A-Z0-9_]*(?:PASSWORD|SECRET|API_KEY|TOKEN)[A-Z0-9_]*)\s*[:=]\s*(.+)$/,
          );
          if (!m) return;
          const valeur = m[2].trim();
          // Une interpolation ne porte pas de valeur ; un commentaire non plus.
          if (valeur.startsWith("${") || valeur.startsWith("#")) return;
          suspects.push(`${fichier}:${i + 1} — ${m[1]}`);
        });
    }
    expect(
      suspects,
      `Une valeur ouvrant une session ou une base est écrite dans le dépôt :\n${suspects.join("\n")}`,
    ).toEqual([]);
  });
});

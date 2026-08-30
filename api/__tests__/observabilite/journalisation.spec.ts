/**
 * Rien n'écrit dans la console sans passer par un journal.
 *
 * Seize appels directs à `console.*` traversaient le code applicatif. Côté
 * serveur, ils échappaient au journal structuré : pas d'identifiant de requête,
 * pas de niveau exploitable, rien qu'une ligne perdue dans la sortie standard.
 * Côté navigateur, ils écrivaient dans la console d'un élève, que personne ne
 * lit — et ils rendaient indiscernables, pour les tests de parcours, une erreur
 * signalée proprement et un défaut.
 *
 * Les scripts en ligne de commande font exception : leur sortie est leur
 * interface.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const RACINE = join(import.meta.dirname, "..", "..", "..");
const DOSSIERS = ["api", "src", "contracts"];
const IGNORES = new Set(["node_modules", "dist", "coverage", "__tests__"]);

/** Les deux seuls endroits qui ont le droit d'écrire dans la console. */
const JOURNAUX = ["api/lib/logger.ts", "src/lib/journal.ts"];

function sources(dossier: string): string[] {
  const trouves: string[] = [];
  const parcourir = (chemin: string) => {
    for (const entree of readdirSync(chemin)) {
      if (IGNORES.has(entree)) continue;
      const complet = join(chemin, entree);
      if (statSync(complet).isDirectory()) parcourir(complet);
      else if (/\.tsx?$/.test(entree) && !/\.spec\.ts$/.test(entree)) trouves.push(complet);
    }
  };
  parcourir(join(RACINE, dossier));
  return trouves;
}

const FICHIERS = DOSSIERS.flatMap(sources);
const chemin = (f: string) => relative(RACINE, f).split(sep).join("/");

describe("journalisation", () => {
  it("balaie effectivement les sources", () => {
    expect(FICHIERS.length).toBeGreaterThan(80);
  });

  it("n'appelle jamais console.* hors des journaux", () => {
    const fautes: string[] = [];
    for (const f of FICHIERS) {
      const rel = chemin(f);
      if (JOURNAUX.includes(rel)) continue;
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((ligne, i) => {
          const sansCommentaire = ligne.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
          if (/\bconsole\.(log|info|warn|error|debug|trace|table|dir)\s*\(/.test(sansCommentaire)) {
            fautes.push(`${rel}:${i + 1} — ${ligne.trim()}`);
          }
        });
    }
    expect(
      fautes,
      `Passez par \`logger\` (serveur) ou \`journal\` (navigateur) :\n${fautes.join("\n")}`,
    ).toEqual([]);
  });

  it("les deux journaux existent et sont les seuls recensés", () => {
    for (const j of JOURNAUX) {
      expect(readFileSync(join(RACINE, j), "utf8")).toContain("console");
    }
  });
});

/**
 * Critère 16 : aucun `any`, et aucune suppression de diagnostic — ni de
 * TypeScript, ni d'ESLint, ni de la couverture.
 *
 * Le constat était vrai à un instant donné ; ce test le rend durable. Il lit
 * les sources plutôt que de faire confiance à une revue : un `any` réintroduit
 * dans six mois échouera ici, avec le chemin du fichier et la ligne.
 *
 * Ce fichier a longtemps porté une liste de suppressions justifiées. Elle est
 * vide, et le mécanisme avec : chacune des trois entrées qu'elle contenait
 * couvrait un problème qu'on pouvait résoudre. Le champ mathématique est
 * construit par le constructeur que MathLive exporte au lieu d'être écrit en
 * balise JSX inconnue de React ; le piège au `debugger` de la détection d'outils
 * a été retiré parce qu'il figeait la copie de l'élève au lieu de la surveiller ;
 * la charge utile hostile d'un test nomme sa fiction dans une fonction plutôt
 * que de faire taire le vérificateur. Il n'y a plus de cas à recenser.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const RACINE = join(import.meta.dirname, "..", "..");
const DOSSIERS = ["api", "src", "contracts", "db", "scripts", "e2e"];
const IGNORES = new Set(["node_modules", "dist", "coverage", "test-results", "migrations"]);

/**
 * Toute forme d'exception au contrôle automatique. Une exception locale n'est
 * pas une correction : elle déplace le problème hors de vue.
 */
const FORMES_DE_SUPPRESSION = [
  "@ts-ignore",
  "@ts-expect-error",
  "eslint-disable",
  "istanbul ignore",
  "c8 ignore",
  "v8 ignore",
];

function fichiersSources(dossier: string): string[] {
  const trouves: string[] = [];
  const parcourir = (chemin: string) => {
    for (const entree of readdirSync(chemin)) {
      if (IGNORES.has(entree)) continue;
      const complet = join(chemin, entree);
      if (statSync(complet).isDirectory()) parcourir(complet);
      else if (/\.(ts|tsx)$/.test(entree)) trouves.push(complet);
    }
  };
  parcourir(join(RACINE, dossier));
  return trouves;
}

// Ce fichier contient les motifs recherchés : s'inclure ferait échouer la
// garde sur elle-même.
const CE_FICHIER = join(RACINE, "api", "__tests__", "typage-strict.spec.ts");
const TOUS = DOSSIERS.flatMap(fichiersSources).filter((f) => f !== CE_FICHIER);

function chemin(f: string): string {
  return relative(RACINE, f).split(sep).join("/");
}

describe("typage strict", () => {
  it("balaie effectivement les sources", () => {
    // Une garde qui ne lit rien passerait toujours.
    expect(TOUS.length).toBeGreaterThan(150);
  });

  it("n'emploie nulle part le type `any`", () => {
    const fautes: string[] = [];
    for (const f of TOUS) {
      const lignes = readFileSync(f, "utf8").split("\n");
      lignes.forEach((ligne, i) => {
        // `any` comme type : « : any », « <any> », « as any », « any[] ».
        // Les occurrences dans un commentaire ou une chaîne ne comptent pas.
        const sansCommentaire = ligne.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
        if (/(:\s*any\b|<any>|\bas\s+any\b|\bany\[\])/.test(sansCommentaire)) {
          fautes.push(`${chemin(f)}:${i + 1} — ${ligne.trim()}`);
        }
      });
    }
    expect(fautes, `\n${fautes.join("\n")}`).toEqual([]);
  });

  it("ne supprime aucun diagnostic, nulle part", () => {
    const fautes: string[] = [];
    for (const f of TOUS) {
      readFileSync(f, "utf8").split("\n").forEach((ligne, i) => {
        for (const forme of FORMES_DE_SUPPRESSION) {
          if (ligne.includes(forme)) fautes.push(`${chemin(f)}:${i + 1} — ${forme}`);
        }
      });
    }
    expect(
      fautes,
      `Une exception au contrôle automatique a été introduite. Corrigez la cause :\n${fautes.join("\n")}`,
    ).toEqual([]);
  });

  it("n'ignore aucun test", () => {
    const fautes: string[] = [];
    for (const f of TOUS) {
      readFileSync(f, "utf8").split("\n").forEach((ligne, i) => {
        if (/\b(it|test|describe)\.(skip|only|todo|fixme|failing)\b/.test(ligne)) {
          fautes.push(`${chemin(f)}:${i + 1} — ${ligne.trim()}`);
        }
      });
    }
    expect(fautes, `\n${fautes.join("\n")}`).toEqual([]);
  });
});

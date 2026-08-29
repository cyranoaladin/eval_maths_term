/**
 * Critère 16 : aucun `any`, aucune suppression de diagnostic TypeScript
 * non justifiée.
 *
 * Le constat était vrai à un instant donné ; ce test le rend durable. Il lit
 * les sources plutôt que de faire confiance à une revue : un `any` réintroduit
 * dans six mois échouera ici, avec le chemin du fichier et la ligne.
 *
 * Les rares suppressions légitimes sont recensées nominativement ci-dessous.
 * Ajouter une entrée est un acte délibéré, visible en revue — c'est
 * exactement l'effet recherché.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const RACINE = join(import.meta.dirname, "..", "..");
const DOSSIERS = ["api", "src", "contracts", "db", "scripts", "e2e"];
const IGNORES = new Set(["node_modules", "dist", "coverage", "test-results", "migrations"]);

/**
 * Suppressions autorisées, chacune avec sa raison.
 * Clé : chemin relatif ; valeur : ce que la suppression couvre.
 */
const SUPPRESSIONS_JUSTIFIEES: Record<string, string> = {
  "src/components/math/MathInput.tsx":
    "<math-field> est un web component que React ne type pas nativement",
  "api/__tests__/security/cheat-immutability.spec.ts":
    "envoie délibérément un type invalide pour vérifier que la validation le refuse",
};

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

  it("n'emploie jamais @ts-ignore", () => {
    // `@ts-ignore` masque n'importe quelle erreur, présente ou future.
    // `@ts-expect-error` échoue si l'erreur disparaît : c'est la seule forme
    // qui reste honnête dans le temps.
    const fautes: string[] = [];
    for (const f of TOUS) {
      readFileSync(f, "utf8").split("\n").forEach((ligne, i) => {
        if (ligne.includes("@ts-ignore")) fautes.push(`${chemin(f)}:${i + 1}`);
      });
    }
    expect(fautes, `\n${fautes.join("\n")}`).toEqual([]);
  });

  it("ne tolère @ts-expect-error que dans les fichiers recensés", () => {
    const inattendus: string[] = [];
    for (const f of TOUS) {
      const rel = chemin(f);
      const contenu = readFileSync(f, "utf8");
      if (!contenu.includes("@ts-expect-error")) continue;
      if (!(rel in SUPPRESSIONS_JUSTIFIEES)) inattendus.push(rel);
    }
    expect(
      inattendus,
      `Suppression non recensée. Si elle est légitime, inscrivez-la dans SUPPRESSIONS_JUSTIFIEES avec sa raison :\n${inattendus.join("\n")}`,
    ).toEqual([]);
  });

  it("chaque suppression recensée est toujours nécessaire", () => {
    // Une justification qui ne correspond plus à rien est une dette qui traîne.
    const obsoletes = Object.keys(SUPPRESSIONS_JUSTIFIEES).filter((rel) => {
      try {
        return !readFileSync(join(RACINE, rel), "utf8").includes("@ts-expect-error");
      } catch {
        return true;
      }
    });
    expect(obsoletes, `\n${obsoletes.join("\n")}`).toEqual([]);
  });
});

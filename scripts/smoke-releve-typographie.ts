/**
 * scripts/smoke-releve-typographie.ts
 *
 * Recette typographique du relevé de notes.
 *
 * Un relevé qui affiche « Ma�l Nguy�n » ou qui superpose deux colonnes est
 * inutilisable, et c'est le genre de défaut qu'un contrôle « le fichier commence
 * par %PDF » ne voit pas. Ce script produit un relevé à partir de données
 * délibérément hostiles — accents, apostrophes typographiques, traits d'union,
 * noms très longs, soixante élèves pour forcer la pagination — puis relit le
 * PDF produit avec `pdftotext` et vérifie ce qui y est réellement écrit.
 *
 * Prérequis : `pdftotext` (paquet poppler-utils).
 *
 *   npx tsx scripts/smoke-releve-typographie.ts
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderRelevePdf, type Releve, type LigneReleve } from "../api/paper/results-pdf";

let echecs = 0;
const ok = (label: string, vrai: boolean, detail = "") => {
  console.log(`  ${vrai ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!vrai) echecs++;
};

/** Noms qu'un établissement français produit réellement. */
const NOMS_DIFFICILES = [
  "Aïcha Benkhelifa-Prévost",
  "Loïc Ngô-Thanh",
  "Zoé Élise d'Artagnan",
  "François-Xavier de La Rochefoucauld-Montmorency",
  "Håkon Ærø",
  "Chloé O'Sullivan",
  "Mehdi Ben Saïd",
  "Anaëlle Guéhenneuc",
  "Jean-Sébastien Müller",
  "Søren Kjærgaard",
];

function lignes(): LigneReleve[] {
  const out: LigneReleve[] = [];
  for (let i = 0; i < 60; i++) {
    const nom = NOMS_DIFFICILES[i % NOMS_DIFFICILES.length];
    const saisie = i % 7 !== 0;
    out.push({
      copyNumber: i + 1,
      nom: i < NOMS_DIFFICILES.length ? nom : `${nom} ${Math.floor(i / NOMS_DIFFICILES.length) + 1}`,
      points: saisie ? Math.round((i % 21) * 0.25 * 4) / 4 : null,
      maxPoints: saisie ? 20 : null,
      note20: saisie ? Math.round(((i % 21) * 0.95) * 4) / 4 : null,
      saisie,
      // Une reprise sur une copie de temps en temps : la colonne ne doit pas
      // se remplir pour tout le monde.
      interventionManuelle: saisie && i % 11 === 0,
    });
  }
  return out;
}

function releve(): Releve {
  const l = lignes();
  const notes = l.filter((x) => x.note20 !== null).map((x) => x.note20!);
  return {
    etablissement: "Lycée français international — Établissement d'épreuve",
    evaluation: "Évaluation n°3 — Suites, limites et intégration",
    classe: "Terminale spécialité — groupe G6",
    tirage: "Tirage du 12 février",
    genereLe: new Date("2026-02-14T10:30:00Z"),
    imprimeLe: new Date("2026-02-12T08:00:00Z"),
    lignes: l,
    stats: {
      saisies: notes.length,
      total: l.length,
      moyenne: notes.reduce((a, b) => a + b, 0) / notes.length,
      min: Math.min(...notes),
      max: Math.max(...notes),
    },
  };
}

async function main() {
  console.log("▶ Relevé de notes — recette typographique\n");

  const r = releve();
  const pdf = await renderRelevePdf(r);
  const dossier = mkdtempSync(join(tmpdir(), "releve-"));
  const chemin = join(dossier, "releve.pdf");
  writeFileSync(chemin, pdf);

  console.log("1. Document produit");
  ok("le fichier est un PDF", pdf.subarray(0, 4).toString() === "%PDF", `${pdf.length} octets`);

  const info = execFileSync("pdfinfo", [chemin], { encoding: "utf8" });
  const pages = Number(info.match(/Pages:\s*(\d+)/)?.[1] ?? 0);
  ok("soixante élèves tiennent sur plusieurs pages", pages >= 2, `${pages} pages`);

  // `-layout` conserve les positions : deux colonnes qui se chevauchent
  // apparaîtraient collées.
  const texte = execFileSync("pdftotext", ["-layout", chemin, "-"], { encoding: "utf8" });

  console.log("\n2. Ce qui est réellement écrit");
  for (const nom of NOMS_DIFFICILES) {
    ok(`« ${nom} »`, texte.includes(nom));
  }

  console.log("\n3. Typographie française");
  ok("les apostrophes sont préservées", texte.includes("d'Artagnan") && texte.includes("O'Sullivan"));
  ok("les traits d'union sont préservés", texte.includes("Benkhelifa-Prévost"));
  ok("aucun caractère de remplacement", !texte.includes("�") && !/\?\?\?/.test(texte));
  ok("le séparateur décimal est la virgule",
    /Moyenne : \d+,\d{2}\/20/.test(texte), texte.match(/Moyenne : [^ ]+/)?.[0] ?? "absente");
  ok("les notes emploient la virgule",
    !/\b\d+\.\d{2}\s*$/m.test(texte.split("Élève")[1] ?? ""));

  console.log("\n4. Structure du tableau");
  ok("l'en-tête est présent", /N°\s+Élève\s+Points\s+Note \/20\s+Saisie\s+Reprise/.test(texte));
  ok("l'en-tête est réimprimé après le saut de page",
    (texte.match(/N°\s+Élève\s+Points/g) ?? []).length >= 2,
    `${(texte.match(/N°\s+Élève\s+Points/g) ?? []).length} occurrences`);
  ok("les copies non saisies sont marquées", /\bnon\b/.test(texte));
  ok("chaque élève a sa ligne",
    (texte.match(/Benkhelifa-Prévost/g) ?? []).length === 6,
    `${(texte.match(/Benkhelifa-Prévost/g) ?? []).length} occurrences attendues : 6`);

  console.log("\n5. Colonne « Reprise »");
  const reprises = r.lignes.filter((l) => l.interventionManuelle).length;
  const ouiApresNote = (texte.match(/\boui\s+oui\b/g) ?? []).length;
  ok("la colonne ne se remplit pas pour tout le monde",
    reprises > 0 && reprises < r.lignes.length, `${reprises} reprises sur ${r.lignes.length} copies`);
  ok("le nombre de reprises imprimées correspond", ouiApresNote === reprises,
    `${ouiApresNote} imprimées, ${reprises} attendues`);

  console.log("\n6. Absence de chevauchement");
  // Sur une extraction `-layout`, deux colonnes qui se superposent produisent
  // des suites de caractères sans espace entre le nom et le nombre.
  const lignesTexte = texte.split("\n").filter((l) => /Benkhelifa-Prévost/.test(l));
  ok("nom et points restent séparés",
    lignesTexte.every((l) => /Prévost\s{2,}/.test(l) || /Prévost\s+\d/.test(l)),
    lignesTexte[0]?.trim().slice(0, 70) ?? "aucune ligne");

  const long = texte.split("\n").find((l) => l.includes("La Rochefoucauld"));
  ok("un nom très long n'écrase pas la colonne suivante",
    !!long && /\d+,\d{2}/.test(long), long?.trim().slice(0, 90) ?? "introuvable");

  console.log(`\nPDF conservé : ${chemin}`);
  console.log(
    echecs === 0
      ? "\n✅ Relevé typographiquement correct : accents, apostrophes, pagination, colonnes."
      : `\n❌ ${echecs} vérification(s) en échec.`,
  );
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n❌ Interrompu :", e instanceof Error ? e.message : e);
  process.exit(1);
});

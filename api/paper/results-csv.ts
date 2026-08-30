/**
 * api/paper/results-csv.ts
 *
 * Relevé de notes d'un tirage, en CSV.
 *
 * Le PDF sert à archiver et à remettre ; le CSV sert à reprendre les notes
 * ailleurs — Pronote, un tableur de conseil de classe, un bulletin. Ce sont
 * deux usages distincts et le second manquait.
 *
 * Deux choix dictés par le terrain français, pas par la commodité :
 *
 * - **Point-virgule** comme séparateur. Excel en configuration française lit
 *   les CSV virgule en une seule colonne, et une note écrite « 12,50 »
 *   contient elle-même une virgule.
 * - **BOM UTF-8** en tête. Sans lui, Excel ouvre le fichier en ANSI et rend
 *   « Aïcha » en « AÃ¯cha ». Les autres tableurs l'ignorent silencieusement.
 */
import type { Releve } from "./results-pdf";

/** Séparateur attendu par les tableurs configurés en français. */
const SEPARATEUR = ";";

/**
 * Marque d'ordre des octets. Excel s'en sert pour reconnaître l'UTF-8 ; sans
 * elle, tous les accents d'une liste de classe sont abîmés à l'ouverture.
 */
export const BOM_UTF8 = "﻿";

/**
 * Échappe une cellule.
 *
 * Une valeur contenant le séparateur, un guillemet ou un saut de ligne doit
 * être entourée de guillemets, les guillemets internes étant doublés — c'est
 * la règle du RFC 4180, celle que tous les tableurs appliquent.
 */
function cellule(valeur: string | number | null): string {
  if (valeur === null || valeur === undefined) return "";
  const texte = String(valeur);
  if (texte.includes(SEPARATEUR) || texte.includes('"') || /[\r\n]/.test(texte)) {
    return `"${texte.replace(/"/g, '""')}"`;
  }
  return texte;
}

/** Nombre écrit à la française : deux décimales, virgule décimale. */
function nombreFr(n: number | null): string {
  return n === null ? "" : n.toFixed(2).replace(".", ",");
}

function dateFr(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export const EN_TETES = [
  "N° copie",
  "Élève",
  "Points",
  "Barème",
  "Note /20",
  "Saisie",
  "Correction manuelle",
] as const;

/**
 * Rend le relevé au format CSV.
 *
 * L'en-tête de contexte — évaluation, classe, date — précède le tableau :
 * un fichier de notes qui ne dit pas de quelle évaluation il vient devient
 * inexploitable dès qu'on en a deux sur le bureau.
 */
export function renderReleveCsv(releve: Releve): string {
  const lignes: string[] = [];

  lignes.push([cellule("Évaluation"), cellule(releve.evaluation)].join(SEPARATEUR));
  lignes.push([cellule("Classe"), cellule(releve.classe)].join(SEPARATEUR));
  if (releve.tirage) {
    lignes.push([cellule("Tirage"), cellule(releve.tirage)].join(SEPARATEUR));
  }
  lignes.push([cellule("Établissement"), cellule(releve.etablissement)].join(SEPARATEUR));
  lignes.push([cellule("Édité le"), cellule(dateFr(releve.genereLe))].join(SEPARATEUR));
  lignes.push(
    [
      cellule("Copies saisies"),
      cellule(`${releve.stats.saisies} / ${releve.stats.total}`),
    ].join(SEPARATEUR),
  );
  lignes.push([cellule("Moyenne /20"), cellule(nombreFr(releve.stats.moyenne))].join(SEPARATEUR));
  lignes.push([cellule("Minimum /20"), cellule(nombreFr(releve.stats.min))].join(SEPARATEUR));
  lignes.push([cellule("Maximum /20"), cellule(nombreFr(releve.stats.max))].join(SEPARATEUR));
  lignes.push("");

  lignes.push(EN_TETES.map(cellule).join(SEPARATEUR));

  for (const l of releve.lignes) {
    lignes.push(
      [
        cellule(l.copyNumber),
        cellule(l.nom),
        cellule(nombreFr(l.points)),
        cellule(l.maxPoints),
        cellule(nombreFr(l.note20)),
        cellule(l.saisie ? "oui" : "non"),
        cellule(l.interventionManuelle ? "oui" : ""),
      ].join(SEPARATEUR),
    );
  }

  // Fin de ligne CRLF : c'est ce qu'attendent les tableurs sous Windows, et les
  // autres s'en accommodent.
  return BOM_UTF8 + lignes.join("\r\n") + "\r\n";
}

/** Nom de fichier proposé au téléchargement. */
export function nomFichierCsv(releve: Releve): string {
  const propre = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `notes-${propre(releve.classe)}-${propre(releve.evaluation)}.csv`.slice(0, 120);
}

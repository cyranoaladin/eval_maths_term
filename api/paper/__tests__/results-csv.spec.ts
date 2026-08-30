/**
 * Le relevé au format tableur.
 *
 * Un fichier de notes ouvert dans Excel avec « AÃ¯cha » à la place d'« Aïcha »,
 * ou dont toutes les colonnes tiennent dans la première, ne sert à rien. Ces
 * tests portent sur ce que le fichier contient réellement.
 */
import { describe, it, expect } from "vitest";
import { renderReleveCsv, nomFichierCsv, BOM_UTF8, EN_TETES } from "../results-csv";
import type { Releve, LigneReleve } from "../results-pdf";

function ligne(sur: Partial<LigneReleve> = {}): LigneReleve {
  return {
    copyNumber: 1,
    nom: "Aïcha Benkhelifa-Prévost",
    points: 15.75,
    maxPoints: 20,
    note20: 15.75,
    saisie: true,
    interventionManuelle: false,
    ...sur,
  };
}

function releve(lignes: LigneReleve[] = [ligne()]): Releve {
  const notes = lignes.filter((l) => l.note20 !== null).map((l) => l.note20!);
  return {
    etablissement: "Lycée français international",
    evaluation: "Évaluation n°3 — Suites et intégration",
    classe: "Terminale spécialité — groupe G6",
    tirage: "Tirage du 12 février",
    genereLe: new Date("2026-02-14T10:30:00Z"),
    imprimeLe: new Date("2026-02-12T08:00:00Z"),
    lignes,
    stats: {
      saisies: notes.length,
      total: lignes.length,
      moyenne: notes.length ? notes.reduce((a, b) => a + b, 0) / notes.length : null,
      min: notes.length ? Math.min(...notes) : null,
      max: notes.length ? Math.max(...notes) : null,
    },
  };
}

describe("renderReleveCsv — lisibilité par un tableur français", () => {
  it("commence par la marque d'ordre des octets", () => {
    // Sans elle, Excel ouvre le fichier en ANSI et abîme tous les accents.
    expect(renderReleveCsv(releve()).startsWith(BOM_UTF8)).toBe(true);
  });

  it("sépare les colonnes par un point-virgule", () => {
    // Excel en configuration française lit un CSV virgule en une seule colonne,
    // et une note écrite « 15,75 » contient elle-même une virgule.
    const csv = renderReleveCsv(releve());
    const enTete = csv.split("\r\n").find((l) => l.startsWith("N° copie"));
    expect(enTete?.split(";")).toHaveLength(EN_TETES.length);
  });

  it("termine ses lignes en CRLF", () => {
    expect(renderReleveCsv(releve())).toContain("\r\n");
  });

  it("écrit les notes avec la virgule décimale", () => {
    const csv = renderReleveCsv(releve([ligne({ note20: 15.75, points: 15.75 })]));
    expect(csv).toContain("15,75");
    expect(csv).not.toContain("15.75");
  });

  it("écrit la moyenne avec deux décimales", () => {
    const csv = renderReleveCsv(releve([ligne({ note20: 12 }), ligne({ note20: 13 })]));
    expect(csv).toMatch(/Moyenne \/20;12,50/);
  });
});

describe("renderReleveCsv — contenu", () => {
  it("préserve accents, apostrophes et traits d'union", () => {
    const csv = renderReleveCsv(releve([
      ligne({ nom: "Aïcha Benkhelifa-Prévost" }),
      ligne({ nom: "Chloé O'Sullivan" }),
      ligne({ nom: "Søren Kjærgaard" }),
      ligne({ nom: "François-Xavier de La Rochefoucauld-Montmorency" }),
    ]));
    expect(csv).toContain("Aïcha Benkhelifa-Prévost");
    expect(csv).toContain("Chloé O'Sullivan");
    expect(csv).toContain("Søren Kjærgaard");
    expect(csv).toContain("François-Xavier de La Rochefoucauld-Montmorency");
    expect(csv).not.toContain("�");
  });

  it("n'abrège aucun nom, même très long", () => {
    // Contrairement au PDF, le tableur n'a pas de colonne de largeur fixe :
    // rien ne justifie de couper.
    const nom = "François-Xavier de La Rochefoucauld-Montmorency-Laval";
    expect(renderReleveCsv(releve([ligne({ nom })]))).toContain(nom);
  });

  it("échappe un nom contenant le séparateur", () => {
    const csv = renderReleveCsv(releve([ligne({ nom: "Dupont; Jean" })]));
    expect(csv).toContain('"Dupont; Jean"');
  });

  it("double les guillemets internes", () => {
    const csv = renderReleveCsv(releve([ligne({ nom: 'Jean "Jojo" Dupont' })]));
    expect(csv).toContain('"Jean ""Jojo"" Dupont"');
  });

  it("rappelle de quelle évaluation et de quelle classe il vient", () => {
    // Un fichier de notes anonyme devient inexploitable dès qu'on en a deux.
    const csv = renderReleveCsv(releve());
    expect(csv).toContain("Évaluation n°3 — Suites et intégration");
    expect(csv).toContain("Terminale spécialité — groupe G6");
    expect(csv).toContain("Tirage du 12 février");
  });

  it("porte une ligne par élève", () => {
    const csv = renderReleveCsv(releve([
      ligne({ copyNumber: 1 }), ligne({ copyNumber: 2 }), ligne({ copyNumber: 3 }),
    ]));
    const apresEnTete = csv.split("N° copie")[1];
    expect(apresEnTete.trim().split("\r\n").filter(Boolean)).toHaveLength(4);
  });

  it("distingue une copie non saisie d'une copie à zéro", () => {
    const csv = renderReleveCsv(releve([
      ligne({ copyNumber: 1, saisie: false, points: null, note20: null, maxPoints: null }),
      ligne({ copyNumber: 2, saisie: true, points: 0, note20: 0 }),
    ]));
    const lignes = csv.split("\r\n");
    const absente = lignes.find((l) => l.startsWith("1;"));
    const zero = lignes.find((l) => l.startsWith("2;"));
    expect(absente).toMatch(/;;;non;$/);
    expect(zero).toContain("0,00");
    expect(zero).toContain(";oui;");
  });

  it("ne signale « correction manuelle » que sur les copies reprises", () => {
    const csv = renderReleveCsv(releve([
      ligne({ copyNumber: 1, interventionManuelle: true }),
      ligne({ copyNumber: 2, interventionManuelle: false }),
    ]));
    const lignes = csv.split("\r\n");
    expect(lignes.find((l) => l.startsWith("1;"))?.endsWith(";oui")).toBe(true);
    expect(lignes.find((l) => l.startsWith("2;"))?.endsWith(";")).toBe(true);
  });

  it("reste valide sans aucune copie saisie", () => {
    const vide = releve([ligne({ saisie: false, points: null, note20: null, maxPoints: null })]);
    const csv = renderReleveCsv(vide);
    expect(csv).toContain("Moyenne /20;");
    expect(csv).toContain("N° copie");
  });
});

describe("nomFichierCsv", () => {
  it("propose un nom de fichier lisible et sans accent", () => {
    const nom = nomFichierCsv(releve());
    expect(nom).toMatch(/^notes-.*\.csv$/);
    expect(nom).not.toMatch(/[éèêàçï—°]/);
  });

  it("reste dans une longueur raisonnable", () => {
    expect(nomFichierCsv(releve()).length).toBeLessThanOrEqual(120);
  });
});

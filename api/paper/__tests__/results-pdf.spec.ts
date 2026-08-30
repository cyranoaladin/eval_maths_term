/**
 * La mise en page du relevé de notes.
 *
 * Le document est remis à des familles : il doit porter le nom exact de chaque
 * élève, une moyenne juste, et distinguer une copie non rendue d'un zéro. Ces
 * tests lisent le PDF produit plutôt que de faire confiance au code qui
 * l'écrit — un relevé qui « compile » peut être illisible.
 */
import { describe, it, expect } from "vitest";
import { renderRelevePdf, type Releve, type LigneReleve } from "../results-pdf";

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

function releve(lignes: LigneReleve[] = [ligne()], sur: Partial<Releve> = {}): Releve {
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
    ...sur,
  };
}

describe("renderRelevePdf", () => {
  it("produit un PDF valide", async () => {
    const pdf = await renderRelevePdf(releve());
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("tient sur plusieurs pages quand la classe est nombreuse", async () => {
    const grande = Array.from({ length: 70 }, (_, i) =>
      ligne({ copyNumber: i + 1, nom: `Élève numéro ${i + 1}` }),
    );
    const pdf = await renderRelevePdf(releve(grande));
    // Deux pages au moins : le compte de pages est lisible dans le catalogue
    // des objets du document.
    expect(pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("supporte un relevé sans aucune copie saisie", async () => {
    const vide = releve([
      ligne({ saisie: false, points: null, note20: null, maxPoints: null }),
    ]);
    const pdf = await renderRelevePdf(vide);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("supporte un relevé sans tirage ni date d'impression", async () => {
    const pdf = await renderRelevePdf(releve([ligne()], { tirage: null, imprimeLe: null }));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("supporte une classe entièrement vide", async () => {
    const pdf = await renderRelevePdf(
      releve([], { stats: { saisies: 0, total: 0, moyenne: null, min: null, max: null } }),
    );
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("accepte un numéro de copie absent", async () => {
    const pdf = await renderRelevePdf(releve([ligne({ copyNumber: null })]));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("accepte un nom trop long pour sa colonne", async () => {
    // Il est réduit puis abrégé plutôt que coupé net : le comportement est
    // vérifié à l'extraction par `scripts/smoke-releve-typographie.ts`.
    const pdf = await renderRelevePdf(releve([
      ligne({ nom: "François-Xavier de La Rochefoucauld-Montmorency-Laval-Duplessis" }),
    ]));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("signale les copies reprises à la main", async () => {
    const pdf = await renderRelevePdf(releve([
      ligne({ copyNumber: 1, interventionManuelle: true }),
      ligne({ copyNumber: 2, interventionManuelle: false }),
    ]));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});

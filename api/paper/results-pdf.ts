/**
 * api/paper/results-pdf.ts
 *
 * Relevé de notes d'un tirage, en PDF.
 *
 * Pourquoi pdfkit et pas LaTeX. La chaîne LaTeX n'est présente que dans l'image
 * dérivée qui embarque AMC ; un relevé de notes produit par `pdflatex` serait
 * indisponible sur l'image de base, alors qu'il n'a rien à voir avec
 * l'impression des sujets. pdfkit est du JavaScript pur, sans binaire natif, et
 * son encodage WinAnsi couvre les accents français.
 *
 * Le document n'est pas un CSV mis en page : il porte les informations qu'un
 * enseignant regarde — moyenne, extrêmes, copies manquantes — et signale les
 * notes contenant une intervention manuelle, parce que ce sont celles qu'on
 * doit pouvoir justifier.
 */
import PDFDocument from "pdfkit";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  classes, evaluations, paperCopies, paperExams, responses, sessions, students,
} from "@db/schema";
import { toNumber } from "../lib/decimal";
import { env } from "../lib/env";


export interface LigneReleve {
  copyNumber: number | null;
  nom: string;
  points: number | null;
  maxPoints: number | null;
  note20: number | null;
  saisie: boolean;
  /** Vrai si une note automatique a été reprise à la main. */
  interventionManuelle: boolean;
}

export interface Releve {
  etablissement: string;
  evaluation: string;
  classe: string;
  tirage: string | null;
  genereLe: Date;
  imprimeLe: Date | null;
  lignes: LigneReleve[];
  stats: {
    saisies: number;
    total: number;
    moyenne: number | null;
    min: number | null;
    max: number | null;
  };
}

/** Rassemble les données du relevé. Aucune mise en forme ici. */
export async function buildReleve(paperExamId: number): Promise<Releve> {
  const db = getDb();

  const [entete] = await db
    .select({
      exam: paperExams,
      classe: classes.name,
      evaluation: evaluations.title,
    })
    .from(paperExams)
    .innerJoin(classes, eq(classes.id, paperExams.classId))
    .innerJoin(evaluations, eq(evaluations.id, paperExams.evaluationId))
    .where(eq(paperExams.id, paperExamId))
    .limit(1);

  if (!entete) throw new Error("Tirage introuvable");

  const copies = await db
    .select({
      copyNumber: paperCopies.copyNumber,
      enteredAt: paperCopies.enteredAt,
      sessionId: paperCopies.sessionId,
      lastName: students.lastName,
      firstName: students.firstName,
      totalScore: sessions.totalScore,
      maxScore: sessions.maxScore,
      normalizedScore: sessions.normalizedScore,
    })
    .from(paperCopies)
    .innerJoin(students, eq(students.id, paperCopies.studentId))
    .leftJoin(sessions, eq(sessions.id, paperCopies.sessionId))
    .where(eq(paperCopies.paperExamId, paperExamId))
    .orderBy(asc(students.lastName), asc(students.firstName));

  // Seules les **reprises** d'une note automatique sont signalées.
  // Noter une question rédigée sur copie est le fonctionnement normal du
  // papier : marquer toutes les copies ferait perdre tout signal à la colonne.
  // Ce qui doit se justifier, c'est d'avoir modifié ce que le barème avait donné.
  const idsSessions = copies.map((c) => c.sessionId).filter((v): v is number => v !== null);
  const manuelles = new Set<number>();
  if (idsSessions.length > 0) {
    const modes = await db
      .select({ sessionId: responses.sessionId, gradingMode: responses.gradingMode })
      .from(responses)
      .where(inArray(responses.sessionId, idsSessions));
    for (const m of modes) {
      if (m.gradingMode === "manual_override") manuelles.add(m.sessionId);
    }
  }

  const lignes: LigneReleve[] = copies.map((c) => ({
    copyNumber: c.copyNumber,
    nom: `${c.lastName} ${c.firstName}`.trim(),
    points: toNumber(c.totalScore),
    maxPoints: c.maxScore,
    note20: toNumber(c.normalizedScore),
    saisie: c.enteredAt !== null,
    interventionManuelle: c.sessionId !== null && manuelles.has(c.sessionId),
  }));

  const notes = lignes.map((l) => l.note20).filter((n): n is number => n !== null);

  return {
    etablissement: env.brandName,
    evaluation: entete.evaluation,
    classe: entete.classe,
    tirage: entete.exam.label,
    genereLe: new Date(),
    imprimeLe: entete.exam.generatedAt,
    lignes,
    stats: {
      saisies: lignes.filter((l) => l.saisie).length,
      total: lignes.length,
      moyenne: notes.length
        ? Math.round((notes.reduce((a, b) => a + b, 0) / notes.length) * 100) / 100
        : null,
      min: notes.length ? Math.min(...notes) : null,
      max: notes.length ? Math.max(...notes) : null,
    },
  };
}

const dateFr = (d: Date) =>
  d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

/** Rend le relevé en PDF. */
export function renderRelevePdf(releve: Releve): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const morceaux: Buffer[] = [];
    doc.on("data", (c: Buffer) => morceaux.push(c));
    doc.on("end", () => resolve(Buffer.concat(morceaux)));
    doc.on("error", reject);

    const largeur = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    // ── En-tête ──
    doc.fontSize(9).fillColor("#64748b").text(releve.etablissement);
    doc.moveDown(0.3);
    doc.fontSize(17).fillColor("#0f172a").text("Relevé de notes", { continued: false });
    doc.moveDown(0.2);
    doc.fontSize(12).fillColor("#334155").text(releve.evaluation);
    doc.moveDown(0.1);

    const sousTitre = [
      releve.classe,
      releve.tirage,
      releve.imprimeLe ? `imprimé le ${dateFr(releve.imprimeLe)}` : null,
    ].filter(Boolean).join(" · ");
    doc.fontSize(9.5).fillColor("#64748b").text(sousTitre);

    doc.moveDown(0.8);
    doc.moveTo(doc.page.margins.left, doc.y)
       .lineTo(doc.page.margins.left + largeur, doc.y)
       .strokeColor("#cbd5e1").lineWidth(0.7).stroke();
    doc.moveDown(0.8);

    // ── Synthèse ──
    const s = releve.stats;
    doc.fontSize(10).fillColor("#0f172a");
    const fr = (n: number) => n.toFixed(2).replace(".", ",");
    const synthese = [
      `Copies saisies : ${s.saisies} / ${s.total}`,
      s.moyenne !== null ? `Moyenne : ${fr(s.moyenne)}/20` : "Moyenne : —",
      s.min !== null ? `Minimum : ${fr(s.min)}` : null,
      s.max !== null ? `Maximum : ${fr(s.max)}` : null,
    ].filter(Boolean).join("      ");
    doc.text(synthese);
    doc.moveDown(1);

    // ── Tableau ──
    const colonnes = [
      { titre: "N°", x: 0, w: 34, align: "left" as const },
      { titre: "Élève", x: 34, w: 210, align: "left" as const },
      { titre: "Points", x: 244, w: 70, align: "right" as const },
      { titre: "Note /20", x: 314, w: 70, align: "right" as const },
      { titre: "Saisie", x: 384, w: 55, align: "center" as const },
      { titre: "Reprise", x: 439, w: 60, align: "center" as const },
    ];
    const gauche = doc.page.margins.left;

    function enTeteTableau() {
      doc.fontSize(8.5).fillColor("#475569");
      for (const c of colonnes) {
        doc.text(c.titre, gauche + c.x, doc.y, { width: c.w, align: c.align, continued: false });
        doc.y -= doc.currentLineHeight();
      }
      doc.y += doc.currentLineHeight() + 3;
      doc.moveTo(gauche, doc.y).lineTo(gauche + largeur, doc.y)
         .strokeColor("#e2e8f0").lineWidth(0.5).stroke();
      doc.moveDown(0.4);
    }

    enTeteTableau();

    /**
     * Un nom trop long pour sa colonne était coupé net, sans point de suspension :
     * « François-Xavier de La Rochefoucauld- » sur un relevé remis à une
     * famille. On réduit d'abord le corps — un nom long tient presque toujours
     * à 7 points —, et on n'abrège qu'en dernier recours, avec une marque
     * visible que le nom est incomplet.
     */
    function ecrireNom(nom: string, x: number, y: number, largeurCol: number) {
      const corpsNormal = 9.5;
      for (const corps of [corpsNormal, 8.5, 7.5, 7]) {
        doc.fontSize(corps);
        if (doc.widthOfString(nom) <= largeurCol) {
          doc.text(nom, x, y, { width: largeurCol, lineBreak: false });
          doc.fontSize(corpsNormal);
          return;
        }
      }
      doc.fontSize(7);
      let abrege = nom;
      while (abrege.length > 1 && doc.widthOfString(`${abrege}…`) > largeurCol) {
        abrege = abrege.slice(0, -1);
      }
      doc.text(`${abrege}…`, x, y, { width: largeurCol, lineBreak: false });
      doc.fontSize(corpsNormal);
    }

    doc.fontSize(9.5);
    for (const l of releve.lignes) {
      // Saut de page : on réimprime l'en-tête du tableau.
      if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
        doc.addPage();
        enTeteTableau();
        doc.fontSize(9.5);
      }

      const y = doc.y;
      const cells: Array<[string, (typeof colonnes)[number]]> = [
        [l.copyNumber !== null ? String(l.copyNumber) : "—", colonnes[0]],
        [
          l.points !== null
            ? `${String(l.points).replace(".", ",")} / ${l.maxPoints ?? "?"}`
            : "—",
          colonnes[2],
        ],
        [l.note20 !== null ? l.note20.toFixed(2).replace(".", ",") : "—", colonnes[3]],
        [l.saisie ? "oui" : "non", colonnes[4]],
        [l.interventionManuelle ? "oui" : "", colonnes[5]],
      ];

      doc.fillColor(l.saisie ? "#0f172a" : "#94a3b8");
      ecrireNom(l.nom, gauche + colonnes[1].x, y, colonnes[1].w);
      doc.y = y;
      for (const [texte, col] of cells) {
        doc.text(texte, gauche + col.x, y, { width: col.w, align: col.align });
        doc.y = y;
      }
      doc.y = y + doc.currentLineHeight() + 3;
    }

    doc.moveDown(1);
    doc.fontSize(8).fillColor("#94a3b8").text(
      "« Reprise » signale une copie dont au moins une note automatique a été modifiée à la main.",
      gauche, doc.y, { width: largeur },
    );
    doc.moveDown(0.4);
    doc.text(`Document produit le ${dateFr(releve.genereLe)} à ${releve.genereLe.toLocaleTimeString("fr-FR")}.`);

    doc.end();
  });
}

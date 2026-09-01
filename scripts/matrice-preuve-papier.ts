/**
 * scripts/matrice-preuve-papier.ts
 *
 * Génère les cas de la matrice de preuve papier : pour chacun, le `.tex` que
 * produirait un vrai tirage, plus les invariants attendus.
 *
 * On ne compare pas les PDF octet à octet — le moteur TeX horodate ses sorties
 * et deux compilations identiques diffèrent toujours. On vérifie ce qui
 * compte : le document existe, il a le bon nombre de copies, le texte attendu
 * s'y trouve, les accents ont survécu, la feuille-réponses et le corrigé sont
 * là.
 *
 * L'écriture arabe échappe à `pdftotext`, qui perd ou mutile les glyphes en
 * formes de présentation : sa preuve est **visuelle** — la première page des
 * cas marqués `pageReference` est rendue en raster déterministe et comparée à
 * une référence versionnée (`scripts/refs-papier/`). Une police attendue
 * (`policeAttendue`) doit en outre être embarquée dans le PDF.
 *
 * Usage : npx tsx scripts/matrice-preuve-papier.ts <dossier>
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildAmcDocument } from "../api/paper/amc-template";
import type { TemplateQuestion } from "../api/paper/amc-template";
import type { GradingRubric } from "../contracts/grading-rubric";

const racine = process.argv[2];
if (!racine) {
  console.error("Usage : npx tsx scripts/matrice-preuve-papier.ts <dossier>");
  process.exit(1);
}

const qcm = (i: number, correctIndex: number): GradingRubric => ({
  mode: { kind: "qcm", correctIndex },
  points: 1,
});
const vf = (correctValue: "true" | "false"): GradingRubric => ({
  mode: { kind: "true_false", correctValue },
  points: 1,
});

let n = 0;
const question = (
  type: "qcm" | "true_false",
  texte: string,
  options: string[] | null,
  rubric: GradingRubric,
): TemplateQuestion => ({
  id: ++n,
  type,
  question: texte,
  options,
  order: n,
  points: 1,
  gradingRubric: rubric,
});

const eleves = (combien: number) =>
  Array.from({ length: combien }, (_, i) => ({
    id: i + 1,
    lastName: ["Benali", "Cherif", "Dupont", "Éloi", "Ferraün"][i % 5] + String(i + 1),
    firstName: ["Amina", "Bilel", "Chloé", "Dhia", "Éva"][i % 5],
  }));

/*
  Le corpus Unicode obligatoire : latin, accents, apostrophes typographique et
  ASCII, tiret, écriture arabe, nom mixte, accent décomposé (U+0308 combinant).
  Aucun de ces noms n'est translittéré, remplacé ni tronqué.
*/
const CORPUS_UNICODE = [
  { id: 1, lastName: "DUPONT", firstName: "Jean" },
  { id: 2, lastName: "Noël", firstName: "Éléonore" },
  { id: 3, lastName: "O'Connor", firstName: "Brian" },
  { id: 4, lastName: "D’Angelo", firstName: "Maria" },
  { id: 5, lastName: "Ben-Salah", firstName: "Karim" },
  { id: 6, lastName: "بن علي", firstName: "محمد" },
  { id: 7, lastName: "الشاذلي", firstName: "آية" },
  { id: 8, lastName: "عبد الرحمن", firstName: "يوسف" },
  { id: 9, lastName: "Ben Salah", firstName: "Mohamed محمد" },
  // Accent décomposé : « e » + U+0308 combinant, même donnée que « ë ».
  { id: 10, lastName: "Noe\u0308l", firstName: "Chloé" },
];

/** Trente élèves, mélange latin/arabe : la classe réelle d'un lycée de Tunis. */
const elevesMixtes = (combien: number) =>
  Array.from({ length: combien }, (_, i) => ({
    id: i + 1,
    lastName: ["Benali", "بن يوسف", "Dupont", "الشاذلي", "Ferraün", "عبد الرحمن"][i % 6] + (i % 2 ? String(i + 1) : ""),
    firstName: ["Amina", "محمد", "Chloé", "سارة", "Éva", "آية"][i % 6],
  }));

/** Un cas : ce qu'on imprime, et ce qu'on doit retrouver dedans. */
interface Cas {
  nom: string;
  questions: TemplateQuestion[];
  eleves: ReturnType<typeof eleves>;
  titre: string;
  /** Fragments de texte attendus dans sujet.pdf (après extraction). */
  attendu: string[];
  /** Nombre de copies attendu = un exemplaire par élève. */
  copies: number;
  /** Nombre de pages minimal du sujet. */
  pagesMin: number;
  /** Police devant être embarquée dans le PDF (écriture arabe : Amiri). */
  policeAttendue?: string;
  /**
   * Page du sujet à rendre en raster et à comparer à la référence versionnée
   * `scripts/refs-papier/<nom>.png` — la preuve visuelle des cas que
   * `pdftotext` ne sait pas lire (écriture arabe, direction, glyphes).
   */
  pageReference?: number;
}

const FORMULES = [
  question("qcm", "Calculer $\\dfrac{3}{4} + \\dfrac{5}{6}$.", ["$\\dfrac{19}{12}$", "$\\dfrac{8}{10}$", "$\\dfrac{15}{24}$"], qcm(1, 0)),
  question("qcm", "Que vaut $\\sqrt{144} + \\sqrt[3]{27}$ ?", ["$15$", "$12$", "$9$"], qcm(2, 0)),
  question("qcm", "Développer $(x+2)^{3}$.", ["$x^{3}+6x^{2}+12x+8$", "$x^{3}+8$", "$x^{3}+2x^{2}+4x+8$"], qcm(3, 0)),
  question("qcm", "Calculer $\\displaystyle\\int_{0}^{1} 3x^{2}\\,\\mathrm{d}x$.", ["$1$", "$3$", "$\\dfrac{1}{3}$"], qcm(4, 0)),
  question("true_false", "L'ensemble $\\mathbb{R}$ est dénombrable.", null, vf("false")),
  question("true_false", "Pour tout $x \\in \\mathbb{R}$, $\\left|x\\right| \\geq 0$.", null, vf("true")),
];

const ACCENTS = [
  question("qcm", "Où se déroula la conférence de Bretton Woods ?", ["Aux États-Unis", "En Île-de-France", "À Genève"], qcm(1, 0)),
  question("qcm", "Quel élève a réussi l'épreuve ? Réponse : « celui qui a révisé ».", ["Vrai", "Faux", "Ça dépend"], qcm(2, 0)),
  question("true_false", "Le tréma de « Noël » est un signe diacritique.", null, vf("true")),
];

const LONG =
  "Un mobile parcourt une trajectoire rectiligne. Sa position, exprimée en mètres et " +
  "comptée à partir de l'origine du repère, est donnée en fonction du temps $t$ (en secondes) " +
  "par la relation $x(t) = 4t^{2} - 12t + 5$. On demande de déterminer, en justifiant chaque " +
  "étape du raisonnement, l'instant auquel la vitesse instantanée du mobile s'annule, puis " +
  "d'en déduire la nature du mouvement de part et d'autre de cet instant, sans oublier de " +
  "préciser les unités employées à chaque ligne du calcul.";

const cas: Cas[] = [
  {
    nom: "01-un-eleve-qcm",
    questions: [question("qcm", "Capitale de la Tunisie ?", ["Tunis", "Sfax", "Sousse"], qcm(1, 0))],
    eleves: eleves(1),
    titre: "Contrôle de géographie",
    attendu: ["Tunis", "Sfax"],
    copies: 1,
    pagesMin: 2,
  },
  {
    nom: "02-trente-eleves",
    questions: FORMULES.slice(0, 3),
    eleves: eleves(30),
    titre: "Devoir surveillé de mathématiques",
    attendu: ["Devoir surveill"],
    copies: 30,
    pagesMin: 30,
  },
  {
    nom: "03-formules-complexes",
    questions: FORMULES,
    eleves: eleves(2),
    titre: "Analyse et algèbre",
    attendu: ["19", "144", "Vrai", "Faux"],
    copies: 2,
    pagesMin: 2,
  },
  {
    nom: "04-accents-francais",
    questions: ACCENTS,
    eleves: eleves(3),
    titre: "Épreuve d'histoire — société et écritures",
    attendu: ["États-Unis", "Île-de-France", "Noël", "révisé"],
    copies: 3,
    pagesMin: 3,
  },
  {
    nom: "05-enonce-long-multipage",
    questions: [
      question("qcm", LONG, ["$t = 1{,}5$ s", "$t = 3$ s", "$t = 0$ s"], qcm(1, 0)),
      ...FORMULES,
      ...ACCENTS,
    ],
    eleves: eleves(4),
    titre: "Composition de fin de trimestre",
    attendu: ["mobile", "instantan", "États-Unis"],
    copies: 4,
    pagesMin: 8,
  },
  {
    nom: "06-vrai-faux-seul",
    questions: [
      question("true_false", "Le carré d'un réel est positif ou nul.", null, vf("true")),
      question("true_false", "$\\pi$ est un nombre rationnel.", null, vf("false")),
    ],
    eleves: eleves(1),
    titre: "Vrai ou faux",
    attendu: ["Vrai", "Faux"],
    copies: 1,
    pagesMin: 2,
  },
  {
    /*
      Un élève en écriture arabe, seul : sa copie est la page 1, rendue en
      raster et comparée à la référence versionnée. C'est elle qui prouve les
      lettres jointes, l'ordre droite-à-gauche et l'absence de glyphes
      manquants — `pdftotext` ne sait pas lire cette écriture.
    */
    nom: "07-un-eleve-arabe",
    questions: [question("qcm", "Capitale de la Tunisie ?", ["Tunis", "Sfax", "Sousse"], qcm(1, 0))],
    eleves: [{ id: 501, lastName: "بن علي", firstName: "محمد" }],
    titre: "Contrôle de géographie",
    attendu: ["Tunis", "Élève"],
    copies: 1,
    pagesMin: 2,
    policeAttendue: "Amiri",
    pageReference: 1,
  },
  {
    // Nom mixte latin/arabe : chaque écriture dans son sens, sur une page.
    nom: "08-nom-mixte",
    questions: [question("true_false", "Tunis est la capitale de la Tunisie.", null, vf("true"))],
    eleves: [{ id: 502, lastName: "Ben Salah", firstName: "Mohamed محمد" }],
    titre: "Vrai ou faux",
    attendu: ["Ben Salah Mohamed"],
    copies: 1,
    pagesMin: 2,
    policeAttendue: "Amiri",
    pageReference: 1,
  },
  {
    // Le corpus Unicode obligatoire, ensemble sur un même tirage.
    nom: "09-corpus-unicode",
    questions: ACCENTS.slice(0, 2),
    eleves: CORPUS_UNICODE,
    titre: "Épreuve commune — toutes écritures",
    attendu: [
      "DUPONT Jean",
      "Noël Éléonore",
      "O'Connor Brian",
      "D’Angelo Maria",
      "Ben-Salah Karim",
      "Ben Salah Mohamed",
      "Noël Chloé",
    ],
    copies: 10,
    pagesMin: 20,
    policeAttendue: "Amiri",
  },
  {
    // Trente élèves, mélange latin/arabe, plusieurs pages par copie.
    nom: "10-trente-mixtes",
    questions: FORMULES.slice(0, 3),
    eleves: elevesMixtes(30),
    titre: "Devoir surveillé — classe mixte",
    attendu: ["Devoir surveill", "Benali Amina", "Chloé"],
    copies: 30,
    pagesMin: 30,
    policeAttendue: "Amiri",
  },
];

await rm(racine, { recursive: true, force: true });

for (const c of cas) {
  const doc = buildAmcDocument({
    title: c.titre,
    subtitle: "Lycée pilote — 3e année",
    durationMinutes: 60,
    questions: c.questions,
    students: c.eleves,
  });
  const dossier = join(racine, c.nom);
  await mkdir(join(dossier, "sujet-data"), { recursive: true });
  await writeFile(join(dossier, "sujet.tex"), doc.tex, "utf8");
  await writeFile(
    join(dossier, "attendu.json"),
    JSON.stringify(
      {
        nom: c.nom,
        attendu: c.attendu,
        copies: c.copies,
        pagesMin: c.pagesMin,
        questions: doc.includedQuestionIds.length,
        exclues: doc.excluded.length,
        ...(c.policeAttendue ? { policeAttendue: c.policeAttendue } : {}),
        ...(c.pageReference ? { pageReference: c.pageReference } : {}),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`${c.nom} : ${doc.includedQuestionIds.length} questions, ${c.eleves.length} élèves`);
}

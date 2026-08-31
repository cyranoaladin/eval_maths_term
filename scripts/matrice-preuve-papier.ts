/**
 * scripts/matrice-preuve-papier.ts
 *
 * Génère les cas de la matrice de preuve papier : pour chacun, le `.tex` et le
 * `.csv` que produirait un vrai tirage, plus les invariants attendus.
 *
 * On ne compare pas les PDF octet à octet — `pdflatex` horodate ses sorties et
 * deux compilations identiques diffèrent toujours. On vérifie ce qui compte :
 * le document existe, il a le bon nombre de copies, le texte attendu s'y
 * trouve, les accents ont survécu, la feuille-réponses et le corrigé sont là.
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
    lastName: ["Benali", "Cherif", "Dupont", "Éloi", "Ferraün"][i % 5] + String(i + 1),
    firstName: ["Amina", "Bilel", "Chloé", "Dhia", "Éva"][i % 5],
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
  await writeFile(join(dossier, "eleves.csv"), doc.studentsCsv, "utf8");
  await writeFile(
    join(dossier, "attendu.json"),
    JSON.stringify(
      { nom: c.nom, attendu: c.attendu, copies: c.copies, pagesMin: c.pagesMin, questions: doc.includedQuestionIds.length, exclues: doc.excluded.length },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`${c.nom} : ${doc.includedQuestionIds.length} questions, ${c.eleves.length} élèves`);
}

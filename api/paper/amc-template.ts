/**
 * api/paper/amc-template.ts
 *
 * Évaluation → document LaTeX `automultiplechoice`.
 *
 * DÉCISION : aucun mélange. Le sujet imprimé est identique pour tous.
 *
 * AMC sait mélanger questions (`\shufflegroup`) et réponses, et c'est
 * précieux quand les copies sont relues au scanner : AMC connaît alors la
 * permutation de chaque copie. Mais la chaîne visée ici est la **saisie
 * manuelle** : l'enseignant lit « question 3 : B » sur une feuille et le
 * reporte dans une grille. Avec mélange, ni le numéro de question ni la lettre
 * ne désignent la même chose d'une copie à l'autre — la saisie deviendrait
 * ininterprétable et chaque QCM serait noté au hasard.
 *
 * C'est cohérent avec `sessions.mode = 'paper'`, qui applique une
 * correspondance directe entre position saisie et index d'origine.
 *
 * SÉCURITÉ : les énoncés contiennent du LaTeX écrit par l'enseignant et sont
 * donc insérés tels quels — les échapper casserait toutes les formules. En
 * revanche, compiler du LaTeX arbitraire côté serveur ouvre une exécution de
 * commandes via `\write18` et consorts : ces primitives sont refusées avant
 * compilation, en plus du `--no-shell-escape` passé au moteur.
 */
import type { QuestionType } from "@contracts/types";
import type { GradingRubric } from "@contracts/grading-rubric";

export interface TemplateQuestion {
  id: number;
  type: QuestionType;
  question: string;
  options: string[] | null;
  order: number;
  points: number;
  gradingRubric: GradingRubric | null;
}

interface TemplateStudent {
  lastName: string;
  firstName: string;
}

export interface TemplateInput {
  title: string;
  /** Sous-titre : établissement, classe, date. */
  subtitle?: string;
  durationMinutes: number;
  questions: TemplateQuestion[];
  students: TemplateStudent[];
  instructions?: string[];
}

export interface TemplateOutput {
  tex: string;
  /** Contenu du CSV attendu par `\csvreader`. */
  studentsCsv: string;
  /** Questions retenues sur la feuille-réponses, dans l'ordre imprimé. */
  includedQuestionIds: number[];
  /** Questions non grillables, à corriger à part. */
  excluded: Array<{ id: number; reason: string }>;
}

/**
 * Primitives permettant d'exécuter des commandes ou de lire le disque depuis
 * un document LaTeX. Un énoncé qui en contient est refusé.
 */
const PRIMITIVES_INTERDITES = [
  "\\write18",
  "\\immediate",
  "\\openout",
  "\\input",
  "\\include",
  "\\usepackage",
  "\\catcode",
  "\\def",
  "\\csname",
  "\\end{document}",
  "\\documentclass",
];

/*
  Ce qu'un enseignant peut demander à la composition.

  Ces bornes ne sont pas décoratives. Sans elles, un enseignant authentifié
  fait tomber la chaîne d'une manière que personne ne sait lire : un nom
  d'élève de 400 ko fait sortir pdfTeX sur « Unable to read an entire
  line---bufsize=200000 », et AMC rend malgré tout un code de sortie nul sans
  produire le moindre document. Le tirage échoue, mais sur un message qui ne
  désigne ni l'élève, ni la cause.

  Les valeurs sont choisies au-dessus de tout usage scolaire réel, et très
  au-dessous de ce qui casse :

  - `eleves` — 500 copies, soit un lycée entier sur une même épreuve ;
  - `nomEleve` — 120 caractères ; échappé, un caractère occupe au pire 16
    octets, soit 1 920 octets contre les 200 000 du tampon de pdfTeX ;
  - `enonce` et `proposition` — un énoncé de mathématiques, même long avec ses
    formules, tient largement dedans ;
  - `propositionsParQuestion` — AMC étiquette les réponses de A à Z ;
  - `questions`, `titre`, `sousTitre` — bon sens.

  Elles bornent aussi ce qu'une donnée d'enseignant peut atteindre en taille,
  ce dont dépend l'analyse d'applicabilité de CVE-2026-13221 : voir
  `docs/VEX-CANDIDATES.md`.
*/
export const LIMITES = {
  eleves: 500,
  nomEleve: 120,
  questions: 300,
  enonce: 5_000,
  proposition: 1_000,
  propositionsParQuestion: 26,
  titre: 200,
  sousTitre: 200,
} as const;

export class LimiteDepasseeError extends Error {
  readonly limite: keyof typeof LIMITES;
  constructor(limite: keyof typeof LIMITES, message: string) {
    super(message);
    this.name = "LimiteDepasseeError";
    this.limite = limite;
  }
}

/** Vérifie que la demande tient dans ce que la composition sait faire. */
function verifierLesBornes(input: TemplateInput): void {
  if (input.students.length > LIMITES.eleves) {
    throw new LimiteDepasseeError(
      "eleves",
      `Cette classe compte ${input.students.length} élèves ; un tirage en accepte au plus ${LIMITES.eleves}. Scindez la classe en plusieurs groupes.`,
    );
  }
  for (const e of input.students) {
    const nom = `${e.lastName} ${e.firstName}`.trim();
    if (nom.length > LIMITES.nomEleve) {
      throw new LimiteDepasseeError(
        "nomEleve",
        `Le nom « ${nom.slice(0, 40)}… » est trop long : ${nom.length} caractères pour un maximum de ${LIMITES.nomEleve}. Corrigez la liste d'élèves.`,
      );
    }
  }
  if (input.questions.length > LIMITES.questions) {
    throw new LimiteDepasseeError(
      "questions",
      `Cette évaluation compte ${input.questions.length} questions ; un sujet en accepte au plus ${LIMITES.questions}.`,
    );
  }
  if (input.title.length > LIMITES.titre) {
    throw new LimiteDepasseeError(
      "titre",
      `Le titre fait ${input.title.length} caractères pour un maximum de ${LIMITES.titre}.`,
    );
  }
  if ((input.subtitle?.length ?? 0) > LIMITES.sousTitre) {
    throw new LimiteDepasseeError(
      "sousTitre",
      `Le sous-titre fait ${input.subtitle!.length} caractères pour un maximum de ${LIMITES.sousTitre}.`,
    );
  }
  for (const q of input.questions) {
    if (q.question.length > LIMITES.enonce) {
      throw new LimiteDepasseeError(
        "enonce",
        `L'énoncé de la question ${q.id} fait ${q.question.length} caractères pour un maximum de ${LIMITES.enonce}.`,
      );
    }
    const options = q.options ?? [];
    if (options.length > LIMITES.propositionsParQuestion) {
      throw new LimiteDepasseeError(
        "propositionsParQuestion",
        `La question ${q.id} porte ${options.length} propositions ; AMC ne sait en étiqueter que ${LIMITES.propositionsParQuestion}, de A à Z.`,
      );
    }
    for (const o of options) {
      if (o.length > LIMITES.proposition) {
        throw new LimiteDepasseeError(
          "proposition",
          `Une proposition de la question ${q.id} fait ${o.length} caractères pour un maximum de ${LIMITES.proposition}.`,
        );
      }
    }
  }
}

export class UnsafeLatexError extends Error {
  readonly offending: string;
  readonly questionId: number;
  constructor(questionId: number, offending: string) {
    super(
      `La question ${questionId} contient « ${offending} », interdit dans un énoncé : cette primitive permettrait d'exécuter des commandes à la compilation.`,
    );
    this.name = "UnsafeLatexError";
    this.questionId = questionId;
    this.offending = offending;
  }
}

/** Vérifie qu'un fragment d'énoncé ne peut rien exécuter à la compilation. */
export function assertSafeLatex(fragment: string, questionId: number): void {
  const bas = fragment.toLowerCase();
  for (const p of PRIMITIVES_INTERDITES) {
    if (bas.includes(p.toLowerCase())) {
      throw new UnsafeLatexError(questionId, p);
    }
  }
}

/*
  Un seul passage, et c'est délibéré. L'échappement se faisait en plusieurs
  remplacements successifs : la contre-oblique devenait `\textbackslash{}`,
  puis le remplacement suivant échappait les accolades que le premier venait
  d'écrire. Un titre contenant une contre-oblique s'imprimait donc `\{}`.
*/
const ECHAPPEMENTS: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

/** Échappe une valeur qui n'est PAS du LaTeX (nom d'élève, titre). */
export function escapeLatexText(text: string): string {
  return text.replace(/[\\&%$#_{}~^]/g, (c) => ECHAPPEMENTS[c]);
}

/** Identifiant AMC d'une question : stable, sans caractère spécial. */
function questionCode(q: TemplateQuestion): string {
  return `q${q.id}`;
}

function renderQcm(q: TemplateQuestion): string {
  const options = q.options ?? [];
  const correctIndex =
    q.gradingRubric?.mode.kind === "qcm" ? q.gradingRubric.mode.correctIndex : -1;

  const choix = options
    .map((o, i) => `      ${i === correctIndex ? "\\correctchoice" : "\\wrongchoice"}{${o}}`)
    .join("\n");

  // `[o]` : ordre conservé. Sans cela AMC mélange les réponses par copie.
  return `  \\begin{question}{${questionCode(q)}}
    ${q.question}
    \\begin{choices}[o]
${choix}
    \\end{choices}
  \\end{question}`;
}

function renderTrueFalse(q: TemplateQuestion): string {
  const correct =
    q.gradingRubric?.mode.kind === "true_false" ? q.gradingRubric.mode.correctValue : "true";

  const vrai = correct === "true" ? "\\correctchoice{Vrai}" : "\\wrongchoice{Vrai}";
  const faux = correct === "false" ? "\\correctchoice{Faux}" : "\\wrongchoice{Faux}";

  return `  \\begin{question}{${questionCode(q)}}
    ${q.question}
    \\begin{choices}[o]
      ${vrai}
      ${faux}
    \\end{choices}
  \\end{question}`;
}

export function buildAmcDocument(input: TemplateInput): TemplateOutput {
  verifierLesBornes(input);

  const included: TemplateQuestion[] = [];
  const excluded: Array<{ id: number; reason: string }> = [];

  const triees = [...input.questions].sort((a, b) => a.order - b.order);

  for (const q of triees) {
    assertSafeLatex(q.question, q.id);
    for (const o of q.options ?? []) assertSafeLatex(o, q.id);

    if (q.type === "short_answer") {
      // Une réponse rédigée ne se coche pas : elle n'a pas sa place sur une
      // grille de saisie et doit être corrigée à part.
      excluded.push({
        id: q.id,
        reason: "Réponse courte : non grillable, à corriger séparément.",
      });
      continue;
    }
    if (q.type === "qcm" && (q.options?.length ?? 0) < 2) {
      excluded.push({ id: q.id, reason: "QCM sans propositions exploitables." });
      continue;
    }
    if (!q.gradingRubric) {
      excluded.push({ id: q.id, reason: "Barème manquant : bonne réponse inconnue." });
      continue;
    }
    included.push(q);
  }

  const corpsQuestions = included
    .map((q) => (q.type === "qcm" ? renderQcm(q) : renderTrueFalse(q)))
    .join("\n\n");

  const consignes = (
    input.instructions ?? [
      `Durée : ${input.durationMinutes} minutes.`,
      "Une seule réponse par question.",
      "Les réponses doivent être reportées uniquement sur la feuille de réponses séparée.",
    ]
  )
    .map((c) => `      \\item ${escapeLatexText(c)}`)
    .join("\n");

  const titre = escapeLatexText(input.title);
  const sousTitre = input.subtitle ? escapeLatexText(input.subtitle) : "";

  const tex = `\\documentclass[a4paper]{article}

% Document produit automatiquement — ne pas modifier à la main.
% Sujet identique pour tous : condition de la saisie manuelle.
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[francais,bloc,completemulti,separateanswersheet,nowatermark]{automultiplechoice}
\\usepackage{amsmath}
\\usepackage{amsfonts}
\\usepackage{amssymb}
\\usepackage{csvsimple}
\\usepackage{geometry}
\\geometry{margin=2cm}

\\makeatletter
\\renewcommand{\\AMCformQuestion}[1]{\\textbf{Question \\ifnum#1<10 0#1\\else#1\\fi :}}
\\makeatother

\\begin{document}

%%% Questions %%%
\\element{sujet}{
${corpsQuestions.split("\n").map((l) => (l ? "  " + l : l)).join("\n")}
}

\\csvreader[separator=semicolon, head to column names]{eleves.csv}{1=\\Eleves}{
\\onecopy{1}{

\\AMCassociation{\\Eleves}

\\begin{center}
  \\LARGE\\bf ${titre}
\\end{center}
${sousTitre ? `\\begin{center}\n  \\large ${sousTitre}\n\\end{center}` : ""}

\\begin{center}
  \\Large Élève : \\textbf{\\Eleves}
\\end{center}

\\vspace*{.4cm}

\\begin{center}
  \\fbox{\\begin{minipage}{.9\\linewidth}
    \\centering\\bf Consignes
    \\begin{itemize}
${consignes}
    \\end{itemize}
  \\end{minipage}}
\\end{center}

\\vspace*{.6cm}

%%% Corps du sujet — ordre fixe, aucun mélange %%%
\\insertgroup{sujet}

\\AMCcleardoublepage

%%% Feuille de réponses séparée %%%
\\AMCformBegin

\\begin{center}
  \\LARGE\\bf Feuille de réponses
\\end{center}

\\namefield{\\fbox{
  \\begin{minipage}{\\linewidth}
    \\textbf{Nom et prénom :} \\textbf{\\Eleves}\\vspace*{.15cm}
  \\end{minipage}
}}

\\vspace*{.3cm}

\\begin{center}
  \\footnotesize\\textit{Noircissez entièrement la case correspondant à votre réponse.
  Une seule réponse par question.}
\\end{center}

\\vspace*{.2cm}

\\AMCform

}
}

\\end{document}
`;

  /*
    En-tête `Eleves` : nom de colonne attendu par `head to column names`.
    Pas de guillemets : `csvsimple` ne les retire pas et ils s'impriment tels
    quels sur la feuille-réponses. Le point-virgule et le saut de ligne, seuls
    caractères qui casseraient le format, sont remplacés.

    Et le nom est **échappé**. Il ne reste pas dans le CSV : `\csvreader` le
    réinjecte dans le document, où il redevient du LaTeX. Une liste importée
    qui portait une contre-oblique ou une accolade faisait échouer toute la
    composition — `\AMCassociation` refuse une séquence de contrôle — et
    l'enseignant n'avait qu'une erreur LaTeX pour comprendre.
  */
  const studentsCsv = [
    "Eleves",
    ...input.students.map((s) =>
      escapeLatexText(`${s.lastName} ${s.firstName}`.replace(/[;"\r\n]/g, " "))
        .replace(/\s+/g, " ")
        .trim(),
    ),
  ].join("\n");

  return {
    tex,
    studentsCsv,
    includedQuestionIds: included.map((q) => q.id),
    excluded,
  };
}

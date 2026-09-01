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
 * MOTEUR : XeLaTeX. Le produit sert un lycée français de Tunis ; des noms en
 * écriture arabe — « محمد بن علي » — sont des données légitimes, et pdfTeX ne
 * sait pas les composer. XeLaTeX lit l'UTF-8 nativement, `fontspec` fournit
 * les polices, `polyglossia` la typographie française et la direction
 * droite-à-gauche des fragments arabes. Seul le fragment arabe est composé en
 * RTL ; le document reste français. Aucun nom n'est translittéré, aucun
 * caractère remplacé ou supprimé : ce que la composition ne sait pas imprimer
 * est refusé par son nom, avant compilation.
 *
 * IDENTITÉ : `\AMCassociation` reçoit un identifiant machine stable et ASCII
 * (`student-<id>`), jamais le nom. Le nom réel — Unicode, échappé — ne sert
 * qu'à l'affichage. L'association logique d'une copie ne dépend donc pas du
 * rendu d'un nom, et une future correction optique s'appuiera sur cette clé.
 *
 * SÉCURITÉ : les énoncés contiennent du LaTeX écrit par l'enseignant et sont
 * donc insérés tels quels — les échapper casserait toutes les formules. En
 * revanche, compiler du LaTeX arbitraire côté serveur ouvre une exécution de
 * commandes via `\write18` et consorts : ces primitives sont refusées avant
 * compilation, en plus du `--no-shell-escape` qu'AMC passe au moteur.
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
  /** Identifiant interne stable : la clé d'association AMC en dérive. */
  id: number;
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
  d'élève de 400 ko fait sortir le moteur TeX sur « Unable to read an entire
  line---bufsize=200000 », et AMC rend malgré tout un code de sortie nul sans
  produire le moindre document. Le tirage échoue, mais sur un message qui ne
  désigne ni l'élève, ni la cause.

  Les valeurs sont choisies au-dessus de tout usage scolaire réel, et très
  au-dessous de ce qui casse :

  - `eleves` — 500 copies, soit un lycée entier sur une même épreuve ;
  - `nomEleve` — 120 caractères ; échappé et enveloppé pour la direction
    d'écriture, un caractère occupe au pire quelques dizaines d'octets, très
    loin des 200 000 du tampon du moteur ;
  - `enonce` et `proposition` — un énoncé de mathématiques, même long avec ses
    formules, tient largement dedans ;
  - `motInsecable` — la plus longue séquence sans blanc d'un énoncé ou d'une
    proposition. Mesuré sur XeTeX (TeX Live 2025) + AMC 1.7.0 : un mot
    insécable de 950 caractères compose, 1 000 fait tomber le moteur en
    erreur de segmentation, et de 1 100 à 2 000 il **boucle** sans fin — et
    AMC rend un code de sortie nul dans les deux cas. Un blocage de trois
    minutes par tentative, offert à tout enseignant authentifié, n'est pas
    acceptable : la borne coupe très au-dessous, et le refus nomme la
    question. Aucun texte scolaire réel ne porte cinq cents caractères sans
    une seule espace ;
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
  motInsecable: 500,
  propositionsParQuestion: 26,
  titre: 200,
  sousTitre: 200,
  /*
    Pas une longueur : le répertoire de caractères. Cette entrée existe pour
    que le refus porte un nom dans `LimiteDepasseeError`.
  */
  caracteres: 0,
} as const;

/*
  Ce que la composition sait imprimer, en deux répertoires.

  **Textes** — noms d'élèves, titre, sous-titre, consignes. Ils sont échappés
  puis composés par XeLaTeX : latin complet, ponctuation typographique,
  diacritiques combinants, euro, et **écriture arabe** — lettres, formes de
  présentation, suppléments. Chaque famille a été composée pour de vrai sur la
  chaîne XeLaTeX + fontspec + polyglossia avant d'entrer ici : lettres jointes,
  ordre droite-à-gauche, cohabitation avec le français.

  **Énoncés** — du LaTeX d'enseignant, inséré tel quel. Le répertoire y reste
  latin : un fragment arabe dans du LaTeX brut ne peut pas recevoir
  automatiquement son enveloppe de direction sans réécrire le LaTeX de
  l'enseignant, et un caractère hors police serait perdu en silence — ce qui
  est interdit. Le refus est nommé, il désigne la question et le caractère.
*/
const PLAGES_LATINES: Array<[number, number]> = [
  [0x20, 0x7e], // latin de base imprimable
  [0xa0, 0x24f], // suppléments latins, Latin Extended-A et B
  [0x300, 0x36f], // diacritiques combinants
  [0x2010, 0x2027], // tirets, guillemets simples, points de suspension
  [0x2030, 0x205e], // pour mille, primes, espaces typographiques
  [0x20ac, 0x20ac], // euro
];

const PLAGES_ARABES: Array<[number, number]> = [
  [0x0600, 0x06ff], // arabe : lettres, harakat, chiffres arabes-indiens
  [0x0750, 0x077f], // supplément arabe
  [0x08a0, 0x08ff], // arabe étendu A
  [0xfb50, 0xfdff], // formes de présentation A
  [0xfe70, 0xfeff], // formes de présentation B
];

const dansPlages = (point: number, plages: Array<[number, number]>) =>
  plages.some(([bas, haut]) => point >= bas && point <= haut);

/** Le premier caractère hors répertoire, s'il existe. */
function caractereRefuse(texte: string, plages: Array<[number, number]>): string | null {
  for (const c of texte) {
    const point = c.codePointAt(0)!;
    if (point === 0x09 || point === 0x0a || point === 0x0d) continue;
    if (!dansPlages(point, plages)) return c;
  }
  return null;
}

function refuserCaractere(c: string, ou: string, repertoire: string): never {
  const point = c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
  throw new LimiteDepasseeError(
    "caracteres",
    `${ou} contient « ${c} » (U+${point}), que la composition ne sait pas imprimer : ${repertoire}. Remplacez ce caractère.`,
  );
}

/** Textes échappés : latin et arabe. */
function verifierTexte(texte: string, ou: string): void {
  const c = caractereRefuse(texte, [...PLAGES_LATINES, ...PLAGES_ARABES]);
  if (c === null) return;
  refuserCaractere(c, ou, "elle compose le latin et l'arabe");
}

/** Fragments LaTeX d'enseignant : latin seulement. */
function verifierFragmentLatex(texte: string, ou: string): void {
  const c = caractereRefuse(texte, PLAGES_LATINES);
  if (c === null) return;
  refuserCaractere(c, ou, "un énoncé se compose en alphabet latin");
}

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
    verifierTexte(nom, `Le nom « ${nom.slice(0, 40)} »`);
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
  verifierTexte(input.title, "Le titre");
  if (input.subtitle) verifierTexte(input.subtitle, "Le sous-titre");
  for (const c of input.instructions ?? []) verifierTexte(c, "Une consigne");
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
    verifierFragmentLatex(q.question, `L'énoncé de la question ${q.id}`);
    verifierMotsInsecables(q.question, `L'énoncé de la question ${q.id}`);
    for (const o of q.options ?? []) {
      verifierFragmentLatex(o, `Une proposition de la question ${q.id}`);
      verifierMotsInsecables(o, `Une proposition de la question ${q.id}`);
    }
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

/*
  La plus longue séquence sans blanc d'un fragment d'enseignant.

  Mesurée, pas supposée : sur XeTeX + AMC 1.7.0, un mot insécable de 1 000
  caractères tue le moteur (erreur de segmentation), et entre 1 100 et 2 000
  il boucle sans fin — AMC rendant, dans les deux cas, un code de sortie nul.
  Le délai d'exécution du tirage borne le dégât, mais trois minutes de
  processeur par tentative restent un déni de service offert à un compte
  enseignant. On refuse en amont, très au-dessous du seuil, en nommant la
  question et la longueur.
*/
function verifierMotsInsecables(fragment: string, ou: string): void {
  /*
    Les formules ne comptent pas : le crash mesuré est celui d'un *mot* du
    mode texte — une boîte insécable d'un paragraphe. Une formule imbriquée de
    1 200 caractères sans espace (cent vingt fractions, cas 42 du corpus) se
    compose, elle, sans broncher : le mode mathématique construit sa boîte
    autrement. On mesure donc le texte hors des segments `$…$`.
  */
  const horsMath = fragment.replace(/\$[^$]*\$/g, " ");
  for (const mot of horsMath.split(/\s+/)) {
    if (mot.length > LIMITES.motInsecable) {
      throw new LimiteDepasseeError(
        "motInsecable",
        `${ou} contient une séquence de ${mot.length} caractères sans espace ; ` +
          `le moteur de composition n'en accepte pas plus de ${LIMITES.motInsecable} d'un tenant. Coupez-la.`,
      );
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

/*
  Un fragment arabe se compose de droite à gauche — mais seulement lui : le
  document reste français, et mettre la page entière en RTL inverserait tout.
  Chaque séquence de caractères arabes, espaces intérieurs compris, reçoit son
  enveloppe `\textarabic{…}` (polyglossia). Un nom mixte — « Mohamed محمد Ben
  Salah » — garde ainsi son ordre de lecture, chaque écriture dans son sens.

  L'enveloppe est posée APRÈS l'échappement : les caractères arabes ne sont
  pas touchés par l'échappement, et les séquences qu'il produit sont latines.
*/
const SEQUENCE_ARABE =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF](?:[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF ]*[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF])?/g;

/**
 * Prépare un texte d'affichage : normalisation NFC — un accent décomposé
 * (`e` + U+0301) redevient sa forme composée, même donnée, même rendu —,
 * échappement, puis enveloppe de direction sur les seuls fragments arabes.
 */
export function renderDisplayText(text: string): string {
  return escapeLatexText(text.normalize("NFC")).replace(
    SEQUENCE_ARABE,
    (fragment) => `\\textarabic{${fragment}}`,
  );
}

/** Identifiant AMC d'une question : stable, sans caractère spécial. */
function questionCode(q: TemplateQuestion): string {
  return `q${q.id}`;
}

/**
 * Clé d'association AMC d'un élève : identifiant machine stable, ASCII.
 * Jamais le nom — l'identité logique d'une copie ne dépend pas du rendu
 * Unicode d'un nom, et c'est cette clé qu'une correction optique lirait.
 */
export function associationKey(student: { id: number }): string {
  return `student-${student.id}`;
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
    .map((c) => `      \\item ${renderDisplayText(c)}`)
    .join("\n");

  const titre = renderDisplayText(input.title);
  const sousTitre = input.subtitle ? renderDisplayText(input.subtitle) : "";

  /*
    Une copie par élève : `\copiepour{clé}{nom affiché}`, définie une fois,
    appelée une fois par élève. La clé d'association est l'identifiant machine ;
    le nom, déjà échappé et enveloppé, ne sert qu'à l'affichage. Le serveur
    connaît les élèves : aucun CSV intermédiaire, aucune relecture `csvsimple`,
    aucune réinterprétation du nom par un lecteur de fichier.
  */
  const copies = input.students
    .map((s) => {
      const nom = renderDisplayText(`${s.lastName} ${s.firstName}`.replace(/\s+/g, " ").trim());
      return `\\copiepour{${associationKey(s)}}{${nom}}`;
    })
    .join("\n");

  const tex = `\\documentclass[a4paper]{article}

% Document produit automatiquement — ne pas modifier à la main.
% Sujet identique pour tous : condition de la saisie manuelle.
% Moteur : XeLaTeX — UTF-8 natif, fontspec, arabe en droite-à-gauche.
\\usepackage[francais,bloc,completemulti,separateanswersheet,nowatermark]{automultiplechoice}
\\usepackage{amsmath}
\\usepackage{amsfonts}
\\usepackage{amssymb}
\\usepackage{geometry}
\\geometry{margin=2cm}

\\usepackage{fontspec}
\\usepackage{polyglossia}
\\setdefaultlanguage{french}
\\setotherlanguage{arabic}
% Amiri : écriture arabe. Paquet Debian officiel épinglé — voir docs/AMC-RUNTIME.md.
\\newfontfamily\\arabicfont[Script=Arabic]{Amiri}

\\makeatletter
\\renewcommand{\\AMCformQuestion}[1]{\\textbf{Question \\ifnum#1<10 0#1\\else#1\\fi :}}
\\makeatother

\\begin{document}

%%% Questions %%%
\\element{sujet}{
${corpsQuestions.split("\n").map((l) => (l ? "  " + l : l)).join("\n")}
}

%%% Une copie : #1 = clé d'association machine, #2 = nom affiché %%%
\\newcommand{\\copiepour}[2]{%
\\onecopy{1}{

\\AMCassociation{#1}

\\begin{center}
  \\LARGE\\bf ${titre}
\\end{center}
${sousTitre ? `\\begin{center}\n  \\large ${sousTitre}\n\\end{center}` : ""}

\\begin{center}
  \\Large Élève : \\textbf{#2}
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
    \\textbf{Nom et prénom :} \\textbf{#2}\\vspace*{.15cm}
  \\end{minipage}
}}

\\vspace*{.3cm}

\\begin{center}
  \\footnotesize\\textit{Noircissez entièrement la case correspondant à votre réponse.
  Une seule réponse par question.}
\\end{center}

\\vspace*{.2cm}

\\AMCform

}}

%%% Les copies, une par élève %%%
${copies}

\\end{document}
`;

  return {
    tex,
    includedQuestionIds: included.map((q) => q.id),
    excluded,
  };
}

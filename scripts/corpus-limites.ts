/**
 * scripts/corpus-limites.ts
 *
 * Le corpus des entrées difficiles, et ce qu'on exige de chacune.
 *
 * Deux couches se relaient, et le corpus les éprouve toutes les deux.
 *
 * `buildAmcDocument` refuse en amont ce qui n'a aucune chance d'aboutir — une
 * primitive d'exécution, un caractère hors du répertoire latin, une demande
 * démesurée — et le refus doit **nommer la cause** : l'élève, la question, le
 * caractère. Ce qui franchit cette couche est composé pour de vrai par AMC, et
 * là l'exigence change : le tirage peut échouer, mais il doit échouer vite,
 * proprement, sans rien exécuter et sans rien écrire hors de son dossier.
 *
 * Ce que ce corpus interdit, en toutes lettres : un plantage, un blocage, une
 * exécution de commande, une sortie hors du dossier de travail.
 *
 * Usage : npx tsx scripts/corpus-limites.ts <dossier>
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildAmcDocument, LIMITES } from "../api/paper/amc-template";
import type { TemplateInput, TemplateQuestion } from "../api/paper/amc-template";
import type { GradingRubric } from "../contracts/grading-rubric";

const racine = process.argv[2];
if (!racine) {
  console.error("Usage : npx tsx scripts/corpus-limites.ts <dossier>");
  process.exit(1);
}

const QCM: GradingRubric = { mode: { kind: "qcm", correctIndex: 0 }, points: 1 };

const question = (texte: string, options: string[] = ["A", "B"]): TemplateQuestion => ({
  id: 1,
  type: "qcm",
  question: texte,
  options,
  order: 1,
  points: 1,
  gradingRubric: QCM,
});

/** Attache un identifiant interne à chaque élève : la clé d'association AMC. */
const avecIds = (eleves: Array<{ lastName: string; firstName: string }>) =>
  eleves.map((e, i) => ({ id: i + 1, ...e }));

const base = (o: Partial<TemplateInput> = {}): TemplateInput => ({
  title: "Contrôle",
  durationMinutes: 60,
  questions: [question("Capitale de la Tunisie ?", ["Tunis", "Sfax"])],
  students: avecIds([{ lastName: "Dupont", firstName: "Amina" }]),
  ...o,
});

/**
 * `refuse` : la borne doit arrêter l'entrée, et le message doit correspondre.
 * `compose` : l'entrée passe la borne ; AMC doit s'en sortir sans plantage.
 * `echoue`  : l'entrée passe la borne mais AMC ne peut pas la composer ; le
 *             tirage doit échouer proprement, et vite.
 */
type Attente = { sorte: "refuse"; motif: RegExp } | { sorte: "compose" } | { sorte: "echoue" };

interface Cas {
  nom: string;
  entree: TemplateInput;
  attente: Attente;
}

/** Le canari : si une commande s'exécute, ce fichier apparaît dans le dossier. */
export const CANARI = "CANARI-EXECUTION";

const cas: Cas[] = [
  // ── Ce que la couche amont doit refuser ────────────────────────────────
  {
    nom: "01-execution-de-commande",
    entree: base({ questions: [question(`\\write18{touch ${CANARI}}`)] }),
    attente: { sorte: "refuse", motif: /write18/ },
  },
  {
    nom: "02-lecture-de-fichier",
    entree: base({ questions: [question("Voir \\input{/etc/passwd}")] }),
    attente: { sorte: "refuse", motif: /input/ },
  },
  {
    nom: "03-redefinition",
    entree: base({ questions: [question("\\def\\x{y} et ensuite \\x")] }),
    attente: { sorte: "refuse", motif: /def/ },
  },
  {
    // L'arabe est légitime dans un NOM — voir 24 — mais pas dans un énoncé :
    // du LaTeX brut ne peut pas recevoir automatiquement son enveloppe de
    // direction, et un caractère hors police serait perdu en silence.
    nom: "04-ecriture-arabe-dans-un-enonce",
    entree: base({ questions: [question("Traduire مرحبا en français.")] }),
    attente: { sorte: "refuse", motif: /U\+0645/ },
  },
  {
    nom: "05-ideogrammes",
    entree: base({ questions: [question("Combien font 東 + 京 ?")] }),
    attente: { sorte: "refuse", motif: /question 1/ },
  },
  {
    nom: "06-emoji",
    entree: base({ title: "Contrôle 🎉" }),
    attente: { sorte: "refuse", motif: /titre/i },
  },
  {
    nom: "07-nom-demesure",
    entree: base({
      students: avecIds([{ lastName: "N".repeat(LIMITES.nomEleve + 1), firstName: "A" }]),
    }),
    attente: { sorte: "refuse", motif: /trop long/i },
  },
  {
    nom: "08-classe-demesuree",
    entree: base({
      students: Array.from({ length: LIMITES.eleves + 1 }, (_, i) => ({
        id: i + 1,
        lastName: `N${i}`,
        firstName: "A",
      })),
    }),
    attente: { sorte: "refuse", motif: /élèves/ },
  },
  {
    nom: "09-enonce-demesure",
    entree: base({ questions: [question("x".repeat(LIMITES.enonce + 1))] }),
    attente: { sorte: "refuse", motif: /question 1/ },
  },
  {
    /*
      Mesuré sur XeTeX + AMC 1.7.0 : un mot insécable de 1 000 caractères tue
      le moteur (segmentation), et entre 1 100 et 2 000 il boucle sans fin —
      AMC rendant un code nul dans les deux cas. Le refus se fait en amont,
      très au-dessous du seuil, en nommant la question.
    */
    nom: "11-mot-insecable-enonce",
    entree: base({ questions: [question("Voici " + "q".repeat(LIMITES.motInsecable + 1))] }),
    attente: { sorte: "refuse", motif: /sans espace/ },
  },
  {
    nom: "12-mot-insecable-proposition",
    entree: base({ questions: [question("Choisir", ["A", "o".repeat(LIMITES.motInsecable + 1)])] }),
    attente: { sorte: "refuse", motif: /sans espace/ },
  },
  {
    nom: "10-trop-de-propositions",
    entree: base({
      questions: [
        question(
          "Choisir",
          Array.from({ length: LIMITES.propositionsParQuestion + 1 }, (_, i) => `c${i}`),
        ),
      ],
    }),
    attente: { sorte: "refuse", motif: /proposition/ },
  },

  // ── Ce qui doit passer, et composer ────────────────────────────────────
  {
    nom: "20-metacaracteres",
    entree: base({
      questions: [question("Que vaut $(a|b)^{*}$ et $[x,y]$ ?", ["$a+b$", "$a-b$"])],
      students: avecIds([{ lastName: "O'Neill-Dupré", firstName: "Chloé" }]),
    }),
    attente: { sorte: "compose" },
  },
  {
    nom: "21-latin-etendu-et-ponctuation",
    entree: base({
      title: "Contrôle — l\u2019épreuve à 5 € : ñ, ł, ő, ș",
      students: avecIds([{ lastName: "Dupré-Łuka", firstName: "Ősz" }]),
    }),
    attente: { sorte: "compose" },
  },
  {
    nom: "22-caracteres-latex-dans-un-nom",
    entree: base({
      students: avecIds([
        { lastName: "Dupont & Fils 100%", firstName: "Chloé_M" },
        { lastName: "\\input /etc/hostname ", firstName: "Bilel" },
        { lastName: "\\textbf{gras}", firstName: "Amina" },
      ]),
    }),
    attente: { sorte: "compose" },
  },
  {
    // Les bornes de taille, atteintes exactement — avec des espaces : la
    // borne du mot insécable est un cas à part (11 et 12).
    nom: "23-taille-frontiere",
    entree: base({
      questions: [
        question(
          // 5 000 caractères exactement, dont un mot de 500 — les deux bornes.
          "q".repeat(LIMITES.motInsecable) + (" " + "q".repeat(499)).repeat(9),
          // 1 000 caractères exactement, mot maximal en tête.
          ["o".repeat(LIMITES.motInsecable) + " " + "o".repeat(499), "b"],
        ),
      ],
      students: avecIds([{ lastName: "N".repeat(LIMITES.nomEleve - 2), firstName: "A" }]),
    }),
    attente: { sorte: "compose" },
  },
  {
    // Un nom en écriture arabe est une donnée légitime : accepté, composé en
    // droite-à-gauche, jamais translittéré. La preuve du rendu — lettres
    // jointes, direction — vit dans la matrice papier et sa référence
    // visuelle ; ici on prouve que la chaîne compose sans amputer.
    nom: "24-nom-arabe",
    entree: base({
      students: avecIds([
        { lastName: "بن علي", firstName: "محمد" },
        { lastName: "الشاذلي", firstName: "آية" },
        { lastName: "عبد الرحمن", firstName: "يوسف" },
      ]),
    }),
    attente: { sorte: "compose" },
  },
  {
    nom: "25-nom-mixte-latin-arabe",
    entree: base({
      students: avecIds([{ lastName: "Ben Salah", firstName: "Mohamed محمد" }]),
    }),
    attente: { sorte: "compose" },
  },
  {
    // Accent décomposé (e + U+0308) : même donnée que « ë », même document.
    nom: "26-accent-decompose",
    entree: base({
      students: avecIds([{ lastName: "Noe\u0308l", firstName: "Chloé" }]),
    }),
    attente: { sorte: "compose" },
  },

  // ── Ce qui passe la borne mais qu'AMC ne peut pas composer ─────────────
  //
  // L'énoncé est du LaTeX, délibérément : c'est ainsi que les formules
  // arrivent. Un enseignant peut donc écrire du LaTeX invalide, et le tirage
  // échouera. Ce qu'on exige, c'est que l'échec soit net et rapide.
  {
    nom: "40-accolades-desequilibrees",
    entree: base({ questions: [question("Soit $\\dfrac{a}{b$ la fraction")] }),
    attente: { sorte: "echoue" },
  },
  {
    nom: "41-mode-mathematique-ouvert",
    entree: base({ questions: [question("La valeur $x = 3 reste ouverte")] }),
    attente: { sorte: "echoue" },
  },
  {
    // Cent vingt fractions imbriquées : je l'attendais en échec, et LaTeX les
    // compose sans broncher — trois pages, quatre secondes. L'attente était
    // fausse, pas le produit.
    nom: "42-imbrication-profonde",
    entree: base({
      questions: [question("$" + "\\frac{1}{".repeat(120) + "2" + "}".repeat(120) + "$")],
    }),
    attente: { sorte: "compose" },
  },
];

await rm(racine, { recursive: true, force: true });
await mkdir(racine, { recursive: true });

let refuses = 0;
let aComposer = 0;
let fautes = 0;
const plan: Array<{ nom: string; attente: "compose" | "echoue" }> = [];

for (const c of cas) {
  let doc: ReturnType<typeof buildAmcDocument> | null = null;
  let erreur: Error | null = null;
  try {
    doc = buildAmcDocument(c.entree);
  } catch (e) {
    erreur = e as Error;
  }

  if (c.attente.sorte === "refuse") {
    if (!erreur) {
      console.log(`  ✗ ${c.nom} — accepté alors qu'il devait être refusé`);
      fautes++;
    } else if (!c.attente.motif.test(erreur.message)) {
      console.log(`  ✗ ${c.nom} — refusé, mais le message ne dit pas la cause : ${erreur.message}`);
      fautes++;
    } else {
      console.log(`  ✓ ${c.nom} — refusé : ${erreur.message.slice(0, 90)}`);
      refuses++;
    }
    continue;
  }

  if (erreur) {
    console.log(`  ✗ ${c.nom} — refusé alors qu'il devait passer : ${erreur.message}`);
    fautes++;
    continue;
  }

  const dossier = join(racine, c.nom);
  await mkdir(join(dossier, "sujet-data"), { recursive: true });
  await writeFile(join(dossier, "sujet.tex"), doc!.tex, "utf8");
  plan.push({ nom: c.nom, attente: c.attente.sorte });
  aComposer++;
}

await writeFile(join(racine, "plan.json"), JSON.stringify({ canari: CANARI, plan }, null, 2), "utf8");

console.log("");
console.log(`  ${refuses} entrées refusées en amont, ${aComposer} à composer`);
console.log(`CORPUS_LIMITES_AMONT = ${fautes === 0 ? "PASS" : `FAIL (${fautes})`}`);
process.exit(fautes === 0 ? 0 : 1);

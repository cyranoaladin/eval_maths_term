/**
 * scripts/corpus-adversarial.ts
 *
 * Un tirage hostile, mais valide : chaque champ que remplit un enseignant
 * porte des caractères difficiles — métacaractères d'expression régulière,
 * accolades, contre-obliques, Unicode combinant, écriture de droite à gauche,
 * chaînes très longues — et un marqueur unique.
 *
 * Le marqueur sert de traceur : si `ZQXMARKER` apparaît dans un motif
 * d'expression régulière compilé par Perl, dans une requête SQL, ou dans un
 * appel de bibliothèque tracé, alors la donnée de l'enseignant atteint cette
 * fonction. S'il n'y apparaît jamais, elle ne l'atteint pas.
 *
 * Le document reste compilable : on éprouve le chemin complet, pas la gestion
 * d'erreur — celle-ci a ses propres cas dans `scripts/corpus-limites.ts`.
 *
 * Usage : npx tsx scripts/corpus-adversarial.ts <dossier>
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildAmcDocument } from "../api/paper/amc-template";
import type { TemplateQuestion } from "../api/paper/amc-template";
import type { GradingRubric } from "../contracts/grading-rubric";

const racine = process.argv[2];
if (!racine) {
  console.error("Usage : npx tsx scripts/corpus-adversarial.ts <dossier>");
  process.exit(1);
}

export const MARQUEUR = "ZQXMARKER";

/*
  Des caractères qui comptent pour les défauts qu'on instruit :

  - `|` `(` `)` `[` `]` `*` `+` `?` `^` `$` `.` — métacaractères d'expression
    régulière : si une donnée devient un *motif*, ils s'y verront ;
  - `,` `;` — séparateurs des en-têtes CSV, seul endroit du code d'AMC où une
    alternation est bâtie depuis une valeur ;
  - Unicode combinant et écriture de droite à gauche — les fonctions GLib
    incriminées lisent de l'UTF-8 ;
  - une chaîne longue, pour les bornes.
*/
const METACARACTERES = "|()[]*+?.-,;";
const ACCENTS = "éàüñôÉÀÜÑÔçÇ";
// Ce corpus doit **compiler** : il trace le parcours d'une donnée jusqu'au fond
// de la chaîne, et un document qui s'arrête à la première page ne traverse rien. Les
// entrées qui doivent échouer — Unicode hors encodage, accolades déséquilibrées,
// tailles démesurées — ont leur propre corpus dans `scripts/corpus-limites.ts`.
const LONGUE = "Lo" + "n".repeat(400) + "g";

/** Ce qui traverse l'échappement LaTeX : noms, titres, consignes. */
const hostileTexte = (etiquette: string) =>
  `${MARQUEUR}-${etiquette} ${METACARACTERES} ${ACCENTS} & % $ # _ { } ~ ^ \\`;

/*
  Les noms d'élèves ont leur propre borne — 120 caractères, parce qu'au-delà le
  tampon de pdfTeX finit par céder. Le corpus doit passer cette borne : son
  travail est de tracer le parcours d'une donnée jusqu'au fond de la chaîne, pas
  d'éprouver le refus, qui a son corpus à lui.
*/
const hostileNom = (etiquette: string) =>
  `${MARQUEUR}-${etiquette} ${METACARACTERES} ${ACCENTS}`;

/** Ce qui est inséré tel quel : énoncés et propositions, qui sont du LaTeX. */
const hostileLatex = (etiquette: string) =>
  `${MARQUEUR}-${etiquette} ${ACCENTS} — ` +
  `$\\dfrac{a|b}{c^{2}}$ et $[x_{1}, x_{2}]$ et $(p+q)^{*}$ et $\\alpha \\ne \\beta$`;

const qcm = (correctIndex: number): GradingRubric => ({
  mode: { kind: "qcm", correctIndex },
  points: 1,
});
const vf = (correctValue: "true" | "false"): GradingRubric => ({
  mode: { kind: "true_false", correctValue },
  points: 1,
});

const questions: TemplateQuestion[] = [
  {
    id: 1,
    type: "qcm",
    question: hostileLatex("enonce"),
    options: [hostileLatex("choix1"), hostileLatex("choix2"), hostileLatex("choix3")],
    order: 1,
    points: 1,
    gradingRubric: qcm(0),
  },
  {
    id: 2,
    type: "qcm",
    question: `${MARQUEUR}-long ${LONGUE} ?`,
    options: [`${LONGUE}-a`, `${LONGUE}-b`],
    order: 2,
    points: 1,
    gradingRubric: qcm(1),
  },
  {
    id: 3,
    type: "true_false",
    question: hostileLatex("vraifaux"),
    options: null,
    order: 3,
    points: 1,
    gradingRubric: vf("false"),
  },
];

/*
  Les noms d'élèves sont échappés puis insérés directement dans le document —
  plus de CSV intermédiaire, plus de lecteur `csvsimple` sur nos données. La
  clé d'association, elle, est l'identifiant machine : le nom, si hostile
  soit-il, n'atteint jamais `\AMCassociation`. Le chemin arabe — enveloppe de
  direction posée après échappement — est éprouvé lui aussi.
*/
const eleves = [
  { id: 1, lastName: hostileNom("nom1"), firstName: hostileNom("prenom1") },
  { id: 2, lastName: `${MARQUEUR}-nom2`, firstName: `${MARQUEUR}-prenom2` },
  { id: 3, lastName: `${MARQUEUR}-nom3 ${ACCENTS}`, firstName: `${MARQUEUR}-prenom3` },
  { id: 4, lastName: `${MARQUEUR}-nom4 بن علي & محمد`, firstName: `${MARQUEUR}-prenom4` },
];

const doc = buildAmcDocument({
  title: hostileTexte("titre"),
  subtitle: hostileTexte("soustitre"),
  durationMinutes: 90,
  questions,
  students: eleves,
  instructions: [hostileTexte("consigne1"), `${MARQUEUR}-consigne2 ${LONGUE}`],
});

await rm(racine, { recursive: true, force: true });
await mkdir(join(racine, "sujet-data"), { recursive: true });
await writeFile(join(racine, "sujet.tex"), doc.tex, "utf8");

const occurrences = (doc.tex.match(new RegExp(MARQUEUR, "g")) ?? []).length;
console.log(`marqueur : ${MARQUEUR}`);
console.log(`  ${occurrences} occurrences dans sujet.tex`);
console.log(`  ${doc.includedQuestionIds.length} questions, ${eleves.length} élèves`);

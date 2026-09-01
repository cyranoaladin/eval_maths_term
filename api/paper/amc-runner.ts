/**
 * api/paper/amc-runner.ts
 *
 * Pilotage d'`auto-multiple-choice` en ligne de commande.
 *
 * On ne réimplémente pas AMC : il fait déjà la mise en page LaTeX des
 * mathématiques, les cases de calage et la numérotation des copies.
 *
 *   prepare --mode s   → sujet.pdf, corrige.pdf, catalog.pdf
 *
 * **Une seule étape, et c'est délibéré.**
 *
 * La chaîne d'origine en comptait trois : `meptex` produisait
 * `data/layout.sqlite` — les positions des cases sur la feuille — et
 * `prepare --mode b` produisait `data/scoring.sqlite` — le barème sous la forme
 * qu'attend la correction optique. Ces deux fichiers ne servent qu'à *lire des
 * copies scannées*, et cette application ne lit pas de copies scannées : la
 * saisie se fait à la main dans la grille, et la note est calculée par le
 * moteur de correction à partir de la base.
 *
 * Aucun code de ce dépôt n'ouvre `layout.sqlite` ni `scoring.sqlite` ; seuls
 * les trois PDF sont téléchargés, et `printedQuestionIds` fige la composition.
 * Les deux étapes retirées coûtaient du temps à chaque tirage et faisaient
 * entrer dans l'image de production toute la pile d'analyse d'images.
 *
 * Voir `docs/ADR-OPTICAL-CORRECTION-BOUNDARY.md`. Une correction optique
 * future les rétablira — dans son propre service, avec sa propre image.
 *
 * Chaque tirage a son propre dossier : deux impressions simultanées ne peuvent
 * pas se marcher dessus.
 *
 * Sûreté : les commandes sont lancées par `execFile`, sans shell — aucun
 * argument ne peut être interprété. Les énoncés ont déjà été filtrés par
 * `assertSafeLatex`.
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { logger } from "../lib/logger";

const run = promisify(execFile);

const AMC = "auto-multiple-choice";

/*
  Ce qu'on accepte de garder de la parole d'AMC. Le journal de LaTeX est
  bavard — quelques centaines de kilo-octets pour un sujet ordinaire — mais il
  n'a aucune raison d'atteindre huit méga-octets. Sans borne explicite, Node
  s'en tient à un méga-octet et tue le processus par `ENOBUFS` : le tirage
  échouerait sur la taille du journal plutôt que sur son contenu.
*/
const SORTIE_MAX = 8 * 1024 * 1024;
const TEX_NAME = "sujet.tex";

/*
  Le moteur de composition. XeLaTeX, et il est demandé explicitement : le
  défaut d'AMC est `latex`, et le document — fontspec, polyglossia, écriture
  arabe — ne compile que sur XeLaTeX. L'interdiction d'exécution de commandes
  reste entière : AMC passe `--no-shell-escape` au moteur, et le moteur
  lui-même est lancé par AMC, jamais par un shell.
*/
const MOTEUR = "xelatex";

export interface AmcArtifact {
  /** Nom de fichier dans le dossier de travail. */
  file: string;
  label: string;
  bytes: number;
}

export interface AmcResult {
  workdir: string;
  artifacts: AmcArtifact[];
  /** Sortie des commandes, conservée pour diagnostic. */
  log: string;
}

class AmcUnavailableError extends Error {
  constructor() {
    super(
      "auto-multiple-choice est introuvable sur ce serveur. Installez le paquet « auto-multiple-choice » pour produire les documents imprimables.",
    );
    this.name = "AmcUnavailableError";
  }
}

/*
  Ce que l'enseignant lit quand la composition échoue.

  Le message partait avec quatre cents caractères de sortie LaTeX. Ce n'est pas
  une trace d'exécution, mais ce n'est pas lisible non plus : devant « Extra },
  or forgotten \endgroup », un enseignant ne sait ni ce qui s'est passé, ni
  quoi corriger. Les signatures ci-dessous viennent d'échecs observés pour de
  vrai, en composant des énoncés hostiles.

  La sortie complète n'est pas perdue : elle reste dans `output`, et le journal
  du serveur la garde. C'est ce qui remonte à l'écran qui change.
*/
const EXPLICATIONS: Array<{ signature: RegExp; message: string }> = [
  {
    signature: /Missing \$ inserted|Missing \} inserted|Extra \}|forgotten \\endgroup|ended by \\end/,
    message:
      "Une formule d'un énoncé est mal écrite : une accolade, une parenthèse ou un « $ » n'est pas refermé. Relisez les énoncés et leurs propositions.",
  },
  {
    signature: /Undefined control sequence/,
    message:
      "Un énoncé emploie une commande LaTeX que le moteur ne connaît pas. Vérifiez l'orthographe des commandes mathématiques.",
  },
  {
    signature: /Unable to read an entire line|bufsize/,
    message:
      "Un énoncé, une proposition ou un nom d'élève est trop long pour le moteur de composition. Raccourcissez-le.",
  },
  {
    signature: /Unicode character|Missing character/,
    message:
      "Un caractère du document ne peut pas être imprimé par les polices de la composition. Aucun caractère n'est remplacé ni supprimé : corrigez ou signalez le caractère en cause.",
  },
  {
    signature: /File .* not found|not found/,
    message:
      "Le moteur de composition n'a pas trouvé un fichier dont il a besoin. C'est une anomalie du serveur, pas de votre sujet : prévenez l'administrateur.",
  },
];

function expliquer(sortie: string): string {
  // Un message déjà rédigé pour l'enseignant se suffit à lui-même.
  if (sortie.startsWith("La composition s'est terminée sans produire")) return sortie;
  for (const e of EXPLICATIONS) {
    if (e.signature.test(sortie)) return e.message;
  }
  return "La composition du sujet a échoué. Le détail est dans le journal du serveur ; prévenez l'administrateur si le problème persiste.";
}

class AmcFailedError extends Error {
  readonly step: string;
  readonly output: string;
  constructor(step: string, output: string) {
    super(expliquer(output));
    this.name = "AmcFailedError";
    this.step = step;
    this.output = output;
  }
}

/** Vrai si le binaire AMC est disponible. Permet de dégrader l'IHM. */
export async function isAmcAvailable(): Promise<boolean> {
  try {
    await run("which", [AMC], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const ARTIFACTS_ATTENDUS: Array<{ file: string; label: string }> = [
  { file: "sujet.pdf", label: "Sujet à imprimer" },
  { file: "corrige.pdf", label: "Corrigé" },
  { file: "catalog.pdf", label: "Catalogue des questions" },
];

export interface RunAmcInput {
  /** Dossier de travail dédié au tirage. */
  workdir: string;
  tex: string;
  timeoutMs?: number;
}

export async function runAmc(input: RunAmcInput): Promise<AmcResult> {
  if (!(await isAmcAvailable())) throw new AmcUnavailableError();

  const { workdir } = input;
  const timeout = input.timeoutMs ?? 180_000;
  const journal: string[] = [];

  // AMC dérive son dossier de projet du nom du fichier source (`sujet.tex` →
  // `sujet-data/`) et n'essaie pas de le créer : sans lui, `prepare` échoue sur
  // « unable to open database ».
  const projectData = TEX_NAME.replace(/\.tex$/, "-data");
  await mkdir(join(workdir, projectData), { recursive: true });
  await writeFile(join(workdir, TEX_NAME), input.tex, "utf8");

  const etapes: Array<{ nom: string; args: string[] }> = [
    {
      nom: "prepare --mode s",
      args: ["prepare", "--mode", "s", "--with", MOTEUR, "--prefix", "./", TEX_NAME],
    },
  ];

  for (const etape of etapes) {
    try {
      const { stdout, stderr } = await run(AMC, etape.args, {
        cwd: workdir,
        timeout,
        maxBuffer: SORTIE_MAX,
      });
      journal.push(`$ ${AMC} ${etape.args.join(" ")}\n${stdout}${stderr}`);
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      // Selon l'échec, AMC a parlé sur la sortie standard, sur la sortie
      // d'erreur, ou pas du tout — et il ne reste alors que le message système.
      const sortie = [err.stdout, err.stderr, err.message].filter(Boolean).join("");
      journal.push(`$ ${AMC} ${etape.args.join(" ")}\nÉCHEC\n${sortie}`);
      logger.error("[amc] Étape en échec", { etape: etape.nom, sortie: sortie.slice(-400) });
      throw new AmcFailedError(etape.nom, sortie);
    }
  }

  /*
    Mesuré : un caractère sans glyphe dans la police ne fait PAS échouer la
    composition — XeLaTeX imprime « Missing character », rend un code de sortie
    nul, et le caractère disparaît du document. Un nom d'élève amputé en
    silence est interdit : la validation du gabarit refuse ces caractères en
    amont, et ce contrôle-ci ferme le chemin si un caractère passait quand
    même — le tirage échoue en le nommant plutôt que d'imprimer un nom faux.
  */
  const sortieComplete = journal.join("\n");
  if (/Missing character/.test(sortieComplete)) {
    const detail = sortieComplete.match(/Missing character:[^\n]*/g) ?? [];
    logger.error("[amc] Caractères sans glyphe", { workdir, detail: detail.slice(0, 5) });
    throw new AmcFailedError("prepare --mode s", detail.join("\n") || "Missing character");
  }

  const artifacts: AmcArtifact[] = [];
  for (const a of ARTIFACTS_ATTENDUS) {
    const chemin = join(workdir, a.file);
    try {
      await access(chemin, constants.R_OK);
      const { size } = await (await import("node:fs/promises")).stat(chemin);
      artifacts.push({ ...a, bytes: size });
    } catch {
      // AMC ne produit pas toujours le catalogue : son absence n'est pas un échec.
      logger.warn("[amc] Document attendu absent", { file: a.file });
    }
  }

  if (!artifacts.some((a) => a.file === "sujet.pdf")) {
    /*
      Vu en vrai : pdfTeX abandonne, et AMC rend malgré tout un code de sortie
      nul. Sans ce contrôle, le tirage serait enregistré comme réussi et
      l'enseignant découvrirait l'absence de sujet au moment de l'imprimer.
    */
    throw new AmcFailedError(
      "prepare --mode s",
      "La composition s'est terminée sans produire aucun document. " +
        "Vérifiez les énoncés : une formule mal écrite suffit à interrompre le moteur.",
    );
  }

  logger.info("[amc] Documents produits", {
    workdir,
    artifacts: artifacts.map((a) => `${a.file} (${Math.round(a.bytes / 1024)} ko)`),
  });

  return { workdir, artifacts, log: journal.join("\n\n") };
}

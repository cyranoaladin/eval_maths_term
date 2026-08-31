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
const CSV_NAME = "eleves.csv";

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

class AmcFailedError extends Error {
  readonly step: string;
  readonly output: string;
  constructor(step: string, output: string) {
    super(`Étape AMC « ${step} » en échec : ${output.slice(-400)}`);
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
  studentsCsv: string;
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
  await writeFile(join(workdir, CSV_NAME), input.studentsCsv, "utf8");

  const etapes: Array<{ nom: string; args: string[] }> = [
    { nom: "prepare --mode s", args: ["prepare", "--mode", "s", "--prefix", "./", TEX_NAME] },
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
    throw new AmcFailedError("prepare --mode s", "sujet.pdf n'a pas été produit");
  }

  logger.info("[amc] Documents produits", {
    workdir,
    artifacts: artifacts.map((a) => `${a.file} (${Math.round(a.bytes / 1024)} ko)`),
  });

  return { workdir, artifacts, log: journal.join("\n\n") };
}

/**
 * api/paper/amc-runner.ts
 *
 * Pilotage d'`auto-multiple-choice` en ligne de commande.
 *
 * On ne réimplémente pas AMC : il fait déjà la mise en page LaTeX des
 * mathématiques, les cases de calage et la numérotation des copies. La
 * séquence reproduit celle de `QCM_EDS_MATHS_TERM/prepare_korrigo.sh`, seule
 * chaîne éprouvée sur cette machine :
 *
 *   prepare --mode s   → sujet.pdf, corrige.pdf, catalog.pdf, calage.xy
 *   meptex             → data/layout.sqlite (positions des cases)
 *   prepare --mode b   → data/scoring.sqlite (barème)
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

export class AmcUnavailableError extends Error {
  constructor() {
    super(
      "auto-multiple-choice est introuvable sur ce serveur. Installez le paquet « auto-multiple-choice » pour produire les documents imprimables.",
    );
    this.name = "AmcUnavailableError";
  }
}

export class AmcFailedError extends Error {
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
  // « unable to open database ». `prepare_korrigo.sh` le crée pour la même raison.
  const projectData = TEX_NAME.replace(/\.tex$/, "-data");
  await mkdir(join(workdir, projectData), { recursive: true });
  await mkdir(join(workdir, "data"), { recursive: true });
  await mkdir(join(workdir, "cr"), { recursive: true });
  await writeFile(join(workdir, TEX_NAME), input.tex, "utf8");
  await writeFile(join(workdir, CSV_NAME), input.studentsCsv, "utf8");

  const etapes: Array<{ nom: string; args: string[] }> = [
    { nom: "prepare --mode s", args: ["prepare", "--mode", "s", "--prefix", "./", TEX_NAME] },
    { nom: "meptex", args: ["meptex", "--src", "./calage.xy", "--data", "./data"] },
    { nom: "prepare --mode b", args: ["prepare", "--mode", "b", "--data", "./data", TEX_NAME] },
  ];

  for (const etape of etapes) {
    try {
      const { stdout, stderr } = await run(AMC, etape.args, { cwd: workdir, timeout });
      journal.push(`$ ${AMC} ${etape.args.join(" ")}\n${stdout}${stderr}`);
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      const sortie = `${err.stdout ?? ""}${err.stderr ?? ""}${err.message ?? ""}`;
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

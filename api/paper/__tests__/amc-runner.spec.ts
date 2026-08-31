/**
 * Le pilotage d'auto-multiple-choice.
 *
 * Ces tests ne simulent pas `execFile` : ils placent en tête de PATH un
 * exécutable qui porte le nom d'AMC et joue le rôle demandé. On éprouve donc
 * le vrai lancement de processus — les arguments réellement transmis, le
 * dossier de travail réellement utilisé, la sortie réellement collectée — et
 * pas l'idée qu'on s'en fait.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAmc, isAmcAvailable } from "../amc-runner";

let racine = "";
let fauxChemin = "";
let cheminCasse = "";
const PATH_INITIAL = process.env.PATH;

/**
 * Un AMC de théâtre. Son comportement se règle par AMC_SCENARIO, lu à
 * l'exécution : chaque test choisit le sien sans réécrire le fichier.
 */
const SCRIPT = `#!/bin/bash
etape="$1 $2 $3"
case "$AMC_SCENARIO" in
  echec-bavard)
    echo "erreur de composition LaTeX" >&2
    exit 3
    ;;
  echec-muet)
    exit 4
    ;;
esac
echo "amc appelé : $*"
if [ "$1" = "prepare" ] && [ "$2" = "--mode" ] && [ "$3" = "s" ]; then
  printf '%%PDF-1.4 sujet' > sujet.pdf
  printf '%%PDF-1.4 corrige' > corrige.pdf
  if [ "$AMC_SCENARIO" != "sans-catalogue" ] && [ "$AMC_SCENARIO" != "sans-sujet" ]; then
    printf '%%PDF-1.4 catalogue' > catalog.pdf
  fi
  if [ "$AMC_SCENARIO" = "sans-sujet" ]; then rm -f sujet.pdf; fi
  printf 'calage' > calage.xy
fi
exit 0
`;

async function dossierDeTravail(): Promise<string> {
  const d = join(racine, `tirage-${Math.random().toString(36).slice(2)}`);
  await mkdir(d, { recursive: true });
  return d;
}

const entree = (workdir: string) => ({
  workdir,
  tex: "\\documentclass{article}\\begin{document}Sujet\\end{document}",
  studentsCsv: "nom,prenom\nBenkhelifa,Aïcha\n",
  timeoutMs: 20_000,
});

beforeAll(async () => {
  racine = await mkdtemp(join(tmpdir(), "amc-runner-"));
  fauxChemin = join(racine, "bin");
  await mkdir(fauxChemin, { recursive: true });
  await writeFile(join(fauxChemin, "auto-multiple-choice"), SCRIPT, "utf8");
  await chmod(join(fauxChemin, "auto-multiple-choice"), 0o755);

  // Une installation cassée : le fichier est là, exécutable, mais son
  // interpréteur n'existe pas. `which` le trouve, l'exécution échoue avant
  // d'avoir rien écrit — ni sortie standard, ni sortie d'erreur.
  cheminCasse = join(racine, "bin-casse");
  await mkdir(cheminCasse, { recursive: true });
  await writeFile(join(cheminCasse, "auto-multiple-choice"), "#!/interpreteur/absent\n", "utf8");
  await chmod(join(cheminCasse, "auto-multiple-choice"), 0o755);
});

afterAll(async () => {
  process.env.PATH = PATH_INITIAL;
  await rm(racine, { recursive: true, force: true });
});

afterEach(() => {
  delete process.env.AMC_SCENARIO;
  process.env.PATH = PATH_INITIAL;
});

/** Notre AMC d'abord, quoi que la machine possède par ailleurs. */
function amcDeTheatre(scenario?: string) {
  process.env.PATH = `${fauxChemin}:${PATH_INITIAL ?? ""}`;
  if (scenario) process.env.AMC_SCENARIO = scenario;
}

/** Une machine sans AMC : un PATH qui ne contient que notre dossier vide. */
function machineSansAmc() {
  process.env.PATH = join(racine, "vide");
}

describe("disponibilité", () => {
  it("reconnaît un AMC installé", async () => {
    amcDeTheatre();
    await expect(isAmcAvailable()).resolves.toBe(true);
  });

  it("reconnaît une machine sans AMC", async () => {
    machineSansAmc();
    await expect(isAmcAvailable()).resolves.toBe(false);
  });
});

describe("production des documents", () => {
  it("refuse de commencer si AMC n'est pas installé", async () => {
    machineSansAmc();
    const workdir = await dossierDeTravail();
    await expect(runAmc(entree(workdir))).rejects.toThrow(/introuvable sur ce serveur/);
  });

  it("écrit les sources, enchaîne les trois étapes et rend les documents", async () => {
    amcDeTheatre();
    const workdir = await dossierDeTravail();

    const resultat = await runAmc(entree(workdir));

    // Les sources sont posées avant l'appel, dans le dossier du tirage.
    expect(await readFile(join(workdir, "sujet.tex"), "utf8")).toContain("\\documentclass");
    // L'accent survit à l'écriture : AMC lit le CSV en UTF-8.
    expect(await readFile(join(workdir, "eleves.csv"), "utf8")).toContain("Aïcha");

    // Une seule étape : la production des documents.
    expect(resultat.log).toContain("prepare --mode s --prefix ./ sujet.tex");

    /*
      Et rien d'autre. `meptex` et `prepare --mode b` ne servent qu'à lire des
      copies scannées ; ils faisaient entrer toute la pile d'analyse d'images
      dans l'image de production, pour deux fichiers que ce dépôt n'ouvre nulle
      part. Si quelqu'un les réintroduit, ce test le dit.
    */
    expect(resultat.log, "une étape de préparation optique est revenue").not.toMatch(
      /meptex|--mode\s+b/,
    );

    expect(resultat.workdir).toBe(workdir);
    expect(resultat.artifacts.map((a) => a.file)).toEqual([
      "sujet.pdf",
      "corrige.pdf",
      "catalog.pdf",
    ]);
    // La taille annoncée est celle du fichier, pas une estimation.
    for (const a of resultat.artifacts) expect(a.bytes).toBeGreaterThan(0);
  });

  it("crée le dossier de projet dont AMC a besoin sans le créer lui-même", async () => {
    amcDeTheatre();
    const workdir = await dossierDeTravail();
    await runAmc(entree(workdir));
    // « sujet.tex » → « sujet-data » : sans ce dossier, prepare échoue sur
    // « unable to open database ».
    await expect(readFile(join(workdir, "sujet-data"), "utf8")).rejects.toThrow(/EISDIR/);
  });

  it("ne prépare rien pour une correction optique", async () => {
    /*
      Le périmètre de la version : produire des sujets, pas lire des copies
      scannées. Les dossiers `data/` et `cr/` n'existaient que pour `meptex` et
      `prepare --mode b`, et les deux bases qu'ils produisent — positions des
      cases, barème optique — ne sont ouvertes nulle part dans ce dépôt.

      Ce test échoue si l'un ou l'autre revient sans décision explicite.
    */
    amcDeTheatre();
    const workdir = await dossierDeTravail();

    const resultat = await runAmc(entree(workdir));

    for (const artefact of ["data/layout.sqlite", "data/scoring.sqlite"]) {
      await expect(
        readFile(join(workdir, artefact)),
        `${artefact} ne doit pas être produit`,
      ).rejects.toThrow();
    }
    expect(resultat.log.match(/\$ auto-multiple-choice/g) ?? []).toHaveLength(1);
  });

  it("s'arrête en nommant l'étape et en gardant sa sortie", async () => {
    amcDeTheatre("echec-bavard");
    const workdir = await dossierDeTravail();

    await expect(runAmc(entree(workdir))).rejects.toMatchObject({
      name: "AmcFailedError",
      step: "prepare --mode s",
      output: expect.stringContaining("erreur de composition LaTeX"),
    });
  });

  it("rapporte un échec même lorsque la commande ne dit rien", async () => {
    amcDeTheatre("echec-muet");
    const workdir = await dossierDeTravail();

    // Ni stdout ni stderr : il reste le message de l'erreur système, et
    // l'enseignant doit tout de même apprendre quelle étape a lâché.
    await expect(runAmc(entree(workdir))).rejects.toMatchObject({
      name: "AmcFailedError",
      step: "prepare --mode s",
    });
  });

  it("accepte l'absence du catalogue, qu'AMC ne produit pas toujours", async () => {
    amcDeTheatre("sans-catalogue");
    const workdir = await dossierDeTravail();

    const resultat = await runAmc(entree(workdir));

    expect(resultat.artifacts.map((a) => a.file)).toEqual(["sujet.pdf", "corrige.pdf"]);
  });

  it("refuse un tirage sans sujet : c'est la feuille qu'on distribue", async () => {
    amcDeTheatre("sans-sujet");
    const workdir = await dossierDeTravail();

    await expect(runAmc(entree(workdir))).rejects.toMatchObject({
      name: "AmcFailedError",
      step: "prepare --mode s",
      output: expect.stringContaining("sujet.pdf n'a pas été produit"),
    });
  });

  it("nomme l'étape même quand AMC ne démarre pas du tout", async () => {
    // Installation incomplète : le binaire répond à `which` mais ne s'exécute
    // pas. Sans sortie à citer, il reste le message système — et l'enseignant
    // doit savoir que c'est la première étape qui n'a pas démarré.
    process.env.PATH = `${cheminCasse}:${PATH_INITIAL ?? ""}`;
    const workdir = await dossierDeTravail();

    // Le système dit l'échec à sa façon — « Command failed » ici, « spawn …
    // ENOENT » ailleurs. Ce qui doit tenir partout, c'est l'étape nommée et une
    // sortie non vide à montrer à l'enseignant.
    await expect(runAmc(entree(workdir))).rejects.toMatchObject({
      name: "AmcFailedError",
      step: "prepare --mode s",
      output: expect.stringMatching(/\S/),
    });
  });

  it("applique le délai par défaut quand l'appelant n'en donne pas", async () => {
    amcDeTheatre();
    const workdir = await dossierDeTravail();
    const avecDelai = entree(workdir);
    delete (avecDelai as { timeoutMs?: number }).timeoutMs;

    await expect(runAmc(avecDelai)).resolves.toMatchObject({ workdir });
  });
});

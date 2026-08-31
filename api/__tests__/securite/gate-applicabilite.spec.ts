/**
 * Le portail d'applicabilité ferme, il ne s'ouvre pas.
 *
 * C'est sa seule propriété qui compte vraiment. Un portail qui laisse passer
 * ce qu'il n'a pas su classer ne protège de rien, et le jour où il se trompe
 * personne ne s'en aperçoit — c'est exactement ce que faisait l'ancien seuil,
 * qui écartait les vulnérabilités sans correctif amont.
 *
 * Ces tests éprouvent les trois façons dont une attestation cesse d'être
 * vraie : une vulnérabilité que personne n'a examinée, un runtime qui a changé
 * sous l'attestation, et une analyse qui vise une version que l'image ne porte
 * plus.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const run = promisify(execFile);

const PURL = "pkg:deb/debian/exemple@1.2.3?arch=amd64";

/** Un rapport Trivy minimal, portant une seule vulnérabilité. */
const rapport = (cve: string, severite = "CRITICAL") => ({
  Results: [
    {
      Vulnerabilities: [
        {
          VulnerabilityID: cve,
          Severity: severite,
          PkgName: "exemple",
          InstalledVersion: "1.2.3",
          PkgIdentifier: { PURL: PURL },
        },
      ],
    },
  ],
});

/** Une nomenclature minimale, décrivant l'image analysée. */
const sbom = { components: [{ name: "exemple", version: "1.2.3", purl: PURL }] };

const attestation = (empreinte: string, cve: string, purl = PURL) => ({
  "@context": "https://openvex.dev/ns/v0.2.0",
  author: "test",
  timestamp: "2026-08-31T00:00:00Z",
  version: 1,
  "atelier:empreinte_runtime": empreinte,
  statements: [
    {
      vulnerability: { name: cve },
      status: "not_affected",
      justification: "vulnerable_code_not_in_execute_path",
      impact_statement: "jamais appelée",
      products: [{ "@id": "pkg:oci/test", subcomponents: [{ "@id": purl }] }],
    },
  ],
});

let dossier: string;
let empreinte: string;

beforeAll(async () => {
  dossier = await mkdtemp(join(tmpdir(), "gate-vex-"));
  // Par la ligne de commande plutôt que par import : le script est en JavaScript
  // pur, sans déclarations de types, et c'est de toute façon ainsi que la CI
  // l'emploie.
  const { stdout } = await run("node", ["scripts/vex-empreinte.mjs"], { cwd: process.cwd() });
  empreinte = stdout.trim();
});

/** Lance le portail et rend son code de sortie avec sa sortie complète. */
async function portail(fichiers: {
  trivy: unknown;
  sbom: unknown;
  vex: unknown;
}): Promise<{ code: number; sortie: string }> {
  const chemins = await Promise.all(
    Object.entries(fichiers).map(async ([nom, contenu]) => {
      const p = join(dossier, `${nom}-${Math.random().toString(36).slice(2)}.json`);
      await writeFile(p, JSON.stringify(contenu), "utf8");
      return p;
    }),
  );
  try {
    const { stdout } = await run("node", ["scripts/gate-applicabilite.mjs", ...chemins], {
      cwd: process.cwd(),
    });
    return { code: 0, sortie: stdout };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, sortie: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("portail d'applicabilité", () => {
  it("passe quand chaque occurrence porte une attestation nominative", async () => {
    const { code, sortie } = await portail({
      trivy: rapport("CVE-2026-00001"),
      sbom,
      vex: attestation(empreinte, "CVE-2026-00001"),
    });

    expect(sortie).toContain("APPLICABILITY_GATE = PASS");
    expect(sortie).toContain("RAW_CRITICAL = 1");
    expect(sortie).toContain("NOT_AFFECTED = 1");
    expect(code).toBe(0);
  });

  it("échoue sur une vulnérabilité que personne n'a examinée", async () => {
    // Le cas qui arrivera pour de vrai : une CVE publiée demain.
    const { code, sortie } = await portail({
      trivy: rapport("CVE-2027-99999"),
      sbom,
      vex: attestation(empreinte, "CVE-2026-00001"),
    });

    expect(sortie).toContain("UNKNOWN_CRITICAL = 1");
    expect(sortie).toContain("APPLICABILITY_GATE = FAIL");
    expect(code).toBe(1);
  });

  it("échoue quand le runtime a changé sous l'attestation", async () => {
    const { code, sortie } = await portail({
      trivy: rapport("CVE-2026-00001"),
      sbom,
      vex: attestation("0".repeat(64), "CVE-2026-00001"),
    });

    expect(sortie).toContain("porte sur un autre runtime");
    expect(sortie).toContain("APPLICABILITY_GATE = FAIL");
    expect(code).toBe(1);
  });

  it("échoue quand l'analyse vise une version que l'image ne porte plus", async () => {
    const { code, sortie } = await portail({
      trivy: rapport("CVE-2026-00001"),
      sbom,
      vex: attestation(empreinte, "CVE-2026-00001", "pkg:deb/debian/exemple@1.2.2?arch=amd64"),
    });

    expect(sortie).toContain("n'est plus dans l'image");
    expect(sortie).toContain("APPLICABILITY_GATE = FAIL");
    expect(code).toBe(1);
  });

  it("refuse une déclaration « non concerné » sans justification", async () => {
    const vex = attestation(empreinte, "CVE-2026-00001") as {
      statements: Array<Record<string, unknown>>;
    };
    delete vex.statements[0].justification;

    const { code, sortie } = await portail({ trivy: rapport("CVE-2026-00001"), sbom, vex });

    expect(sortie).toContain("sans justification");
    expect(code).toBe(1);
  });

  it("n'admet aucune catégorie d'acceptation de risque", async () => {
    // « risque accepté », « ne sera pas corrigé », « exception temporaire » :
    // aucun de ces statuts n'existe, et un statut inventé ferme la porte.
    const vex = attestation(empreinte, "CVE-2026-00001") as {
      statements: Array<Record<string, unknown>>;
    };
    vex.statements[0].status = "accepted_risk";

    const { code, sortie } = await portail({ trivy: rapport("CVE-2026-00001"), sbom, vex });

    expect(sortie).toContain("statut VEX inconnu");
    expect(sortie).toContain("APPLICABILITY_GATE = FAIL");
    expect(code).toBe(1);
  });

  it("échoue de bout en bout si l'attestation n'a plus rien à voir", async () => {
    const { code } = await portail({ trivy: rapport("CVE-2026-00001"), sbom, vex: {} });
    expect(code).toBe(1);
  });
});

afterAll(async () => {
  if (dossier) await rm(dossier, { recursive: true, force: true });
});

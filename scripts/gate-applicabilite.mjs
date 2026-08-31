/**
 * scripts/gate-applicabilite.mjs
 *
 * Le portail de sécurité de la version : il croise le scan brut, la
 * nomenclature de l'image et l'attestation VEX, puis classe.
 *
 * Le scan reste brut. Rien n'est masqué dans Trivy, rien n'est ignoré : les
 * compteurs `RAW_CRITICAL` et `RAW_HIGH` sont toujours imprimés tels quels.
 * Ce que ce portail ajoute, c'est la seule question qui décide :
 *
 *   cette vulnérabilité est-elle atteignable dans cet artefact-ci ?
 *
 * Trois réponses, et deux d'entre elles ferment la porte :
 *
 *   NOT_AFFECTED  une attestation nominative, avec preuve, dit que non
 *   APPLICABLE    une attestation dit que oui
 *   UNKNOWN       personne n'a répondu
 *
 * `UNKNOWN` est la valeur par défaut, et elle échoue. Une CVE qui apparaît
 * demain sans que quiconque l'ait examinée fait échouer la construction — et
 * c'est le comportement voulu. Le portail ferme, il ne s'ouvre pas.
 *
 * Aucune catégorie « risque accepté », « ne sera pas corrigé » ou « exception
 * temporaire » n'existe ici : elles n'auraient pour effet que de laisser
 * passer ce qu'on n'a pas su démontrer.
 *
 *   node scripts/gate-applicabilite.mjs <trivy.json> <sbom-image.json> [vex.json]
 */
import { readFile } from "node:fs/promises";
import { empreinteRuntime } from "./vex-empreinte.mjs";

const [rapportTrivy, cheminSbom, cheminVex = "security/vex.openvex.json"] =
  process.argv.slice(2);

if (!rapportTrivy || !cheminSbom) {
  console.error(
    "Usage : node scripts/gate-applicabilite.mjs <trivy.json> <sbom-image.json> [vex.json]",
  );
  process.exit(2);
}

const lire = async (f) => JSON.parse(await readFile(f, "utf8"));
const trivy = await lire(rapportTrivy);
const sbom = await lire(cheminSbom);
const vex = await lire(cheminVex);

let echecs = 0;
const grief = (m) => {
  console.log(`  x ${m}`);
  echecs++;
};

// -- 1. L'attestation parle-t-elle bien de ce runtime ? ----------------------
//
// Une preuve « non concerné » dit qu'une fonction n'est jamais appelée par ce
// code-là, dans cette image-là. Changez la recette, la version d'AMC ou le
// code qui pilote la composition, et la preuve est à refaire.
const attendue = await empreinteRuntime();
const declaree = vex["atelier:empreinte_runtime"];
if (declaree !== attendue) {
  grief(
    `l'attestation VEX porte sur un autre runtime.\n` +
      `      empreinte déclarée : ${declaree}\n` +
      `      empreinte actuelle : ${attendue}\n` +
      `      Le Dockerfile, amc-runner, amc-template ou le registre d'épinglage ont changé :\n` +
      `      les analyses d'applicabilité doivent être refaites avant de régénérer l'attestation.`,
  );
} else {
  console.log(`  ok l'attestation porte sur ce runtime (${attendue.slice(0, 16)})`);
}

// -- 2. Ce que l'image contient réellement ----------------------------------
const composantsImage = new Set();
for (const c of sbom.components ?? []) {
  if (c.purl) composantsImage.add(c.purl);
  if (c.name && c.version) composantsImage.add(`${c.name}@${c.version}`);
}

// -- 3. Les déclarations, indexées par (CVE, sous-composant) ------------------
const STATUTS = new Set(["not_affected", "affected", "fixed", "under_investigation"]);
const declarations = new Map();
for (const s of vex.statements ?? []) {
  const cve = s.vulnerability?.name;
  if (!cve) continue;
  if (!STATUTS.has(s.status)) {
    grief(`statut VEX inconnu pour ${cve} : « ${s.status} »`);
    continue;
  }
  if (s.status === "not_affected" && !s.justification) {
    grief(`${cve} est déclarée non concernée sans justification`);
  }
  for (const p of s.products ?? []) {
    for (const sc of p.subcomponents ?? []) {
      const purl = sc["@id"];
      // Une entrée qui ne correspond plus à un composant de l'image est
      // périmée : elle a survécu à une montée de version sans être revue.
      if (!composantsImage.has(purl)) {
        grief(
          `${cve} : le sous-composant « ${purl} » n'est plus dans l'image.\n` +
            `      L'analyse portait sur une autre version : reprenez-la.`,
        );
      }
      declarations.set(`${cve} ${purl}`, s);
    }
  }
}

// -- 4. Le scan brut, intégralement ------------------------------------------
const brut = [];
for (const r of trivy.Results ?? []) {
  for (const v of r.Vulnerabilities ?? []) {
    brut.push({
      cve: v.VulnerabilityID,
      severite: v.Severity,
      paquet: v.PkgName,
      version: v.InstalledVersion,
      purl: v.PkgIdentifier?.PURL ?? `pkg:deb/debian/${v.PkgName}@${v.InstalledVersion}`,
      correctif: v.FixedVersion || null,
    });
  }
}

const classe = { NOT_AFFECTED: [], APPLICABLE: [], UNKNOWN: [] };
for (const v of brut) {
  const s = declarations.get(`${v.cve} ${v.purl}`);
  if (!s) classe.UNKNOWN.push(v);
  else if (s.status === "not_affected" || s.status === "fixed") classe.NOT_AFFECTED.push(v);
  else classe.APPLICABLE.push(v);
}

const compte = (liste, sev) => liste.filter((v) => v.severite === sev).length;

console.log("");
console.log(`RAW_CRITICAL = ${compte(brut, "CRITICAL")}`);
console.log(`RAW_HIGH = ${compte(brut, "HIGH")}`);
console.log(`RAW_TOTAL = ${brut.length}  (${new Set(brut.map((v) => v.cve)).size} CVE distinctes)`);
console.log("");
console.log(`NOT_AFFECTED = ${classe.NOT_AFFECTED.length}`);
console.log(`APPLICABLE_CRITICAL = ${compte(classe.APPLICABLE, "CRITICAL")}`);
console.log(`APPLICABLE_HIGH = ${compte(classe.APPLICABLE, "HIGH")}`);
console.log(`UNKNOWN_CRITICAL = ${compte(classe.UNKNOWN, "CRITICAL")}`);
console.log(`UNKNOWN_HIGH = ${compte(classe.UNKNOWN, "HIGH")}`);

for (const [etiquette, liste] of [
  ["APPLICABLE", classe.APPLICABLE],
  ["UNKNOWN", classe.UNKNOWN],
]) {
  if (liste.length === 0) continue;
  console.log("");
  console.log(`${etiquette} - à traiter :`);
  for (const v of liste) {
    console.log(
      `  ${v.severite.padEnd(8)} ${v.cve.padEnd(18)} ${v.paquet} ${v.version}` +
        (v.correctif ? ` -> correctif ${v.correctif}` : "  (aucun correctif amont)"),
    );
  }
  if (etiquette === "UNKNOWN") {
    console.log("");
    console.log("  Une vulnérabilité que personne n'a examinée est traitée comme applicable.");
    console.log("  Écrivez l'analyse dans security/analyse-applicabilite.json, puis");
    console.log("  régénérez l'attestation : node scripts/vex-generer.mjs <trivy.json>");
  }
}

const bloquant = classe.APPLICABLE.length > 0 || classe.UNKNOWN.length > 0 || echecs > 0;

console.log("");
if (bloquant) {
  console.log("APPLICABILITY_GATE = FAIL");
  process.exit(1);
}
console.log("APPLICABILITY_GATE = PASS");
console.log(
  `   ${brut.length} occurrences brutes, toutes couvertes par une attestation nominative.`,
);

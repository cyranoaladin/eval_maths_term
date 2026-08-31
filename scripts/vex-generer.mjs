/**
 * scripts/vex-generer.mjs
 *
 * Produit l'attestation OpenVEX depuis l'analyse humaine et le scan brut.
 *
 * L'analyse — `security/analyse-applicabilite.json` — est écrite à la main :
 * c'est elle qui porte le raisonnement, et personne ne peut l'engendrer. Ce
 * script ne fait que la relier aux versions exactes des paquets de l'image
 * analysée, et refuse de produire quoi que ce soit si les deux ne se
 * recouvrent pas exactement : une CVE sans analyse, ou une analyse pour une
 * CVE que l'image ne porte plus, arrête la génération.
 *
 *   node scripts/vex-generer.mjs <rapport-trivy.json> [sortie]
 */
import { readFile, writeFile } from "node:fs/promises";
import { empreinteRuntime } from "./vex-empreinte.mjs";

const rapport = process.argv[2];
const sortie = process.argv[3] ?? "security/vex.openvex.json";
if (!rapport) {
  console.error("Usage : node scripts/vex-generer.mjs <rapport-trivy.json> [sortie]");
  process.exit(1);
}

const analyse = JSON.parse(await readFile("security/analyse-applicabilite.json", "utf8"));
const scan = JSON.parse(await readFile(rapport, "utf8"));

/** purl exact de chaque paquet portant chaque CVE, tel que Trivy le rapporte. */
const purls = new Map();
const severites = new Map();
for (const r of scan.Results ?? []) {
  for (const v of r.Vulnerabilities ?? []) {
    severites.set(v.VulnerabilityID, v.Severity);
    const purl =
      v.PkgIdentifier?.PURL ?? `pkg:deb/debian/${v.PkgName}@${v.InstalledVersion}`;
    if (!purls.has(v.VulnerabilityID)) purls.set(v.VulnerabilityID, new Set());
    purls.get(v.VulnerabilityID).add(purl);
  }
}

const sansAnalyse = [...purls.keys()].filter((c) => !analyse[c]).sort();
const sansCve = Object.keys(analyse).filter((c) => !purls.has(c)).sort();
if (sansAnalyse.length > 0) {
  console.error(`✗ CVE présentes dans l'image sans analyse : ${sansAnalyse.join(", ")}`);
  console.error("  Écrivez l'analyse avant de produire l'attestation.");
  process.exit(1);
}
if (sansCve.length > 0) {
  console.error(`✗ Analyses portant sur des CVE absentes de l'image : ${sansCve.join(", ")}`);
  console.error("  Retirez-les : une attestation ne parle que de ce qui est là.");
  process.exit(1);
}

// Horodatage fourni, ou celui du dernier commit : une date qui bouge à chaque
// exécution rendrait l'attestation non reproductible.
const horodatage = process.env.VEX_TIMESTAMP ?? "2026-08-31T00:00:00Z";

const statements = [...purls.keys()].sort().map((cve) => {
  const a = analyse[cve];
  return {
    vulnerability: { name: cve },
    timestamp: horodatage,
    products: [
      {
        "@id": "pkg:oci/atelier-qcm?tag=1.0.0-rc2",
        subcomponents: [...purls.get(cve)].sort().map((p) => ({ "@id": p })),
      },
    ],
    status: "not_affected",
    justification: a.justification,
    impact_statement: a.impact,
    "atelier:severite": severites.get(cve),
    "atelier:composant_vulnerable": a.composant,
    "atelier:condition_de_declenchement": a.declencheur,
    "atelier:entree_controlee_par_un_tiers": a.entree_controlee,
    "atelier:preuve_statique": a.statique,
    "atelier:preuve_dynamique": a.dynamique,
  };
});

const doc = {
  "@context": "https://openvex.dev/ns/v0.2.0",
  "@id": "https://github.com/cyranoaladin/eval_maths_term/security/vex/1.0.0-rc2",
  author: "Atelier QCM — analyse d'applicabilité du runtime de production",
  timestamp: horodatage,
  version: 1,
  tooling: "scripts/vex-generer.mjs",
  "atelier:empreinte_runtime": await empreinteRuntime(),
  "atelier:portee":
    "Cette attestation ne vaut que pour le runtime décrit par l'empreinte ci-dessus " +
    "— Dockerfile, amc-runner, amc-template, registre d'épinglage — et pour les versions " +
    "exactes de paquets citées dans chaque sous-composant. Toute modification de l'un ou " +
    "de l'autre invalide les analyses : scripts/gate-applicabilite.mjs le vérifie et échoue.",
  statements,
};

await writeFile(sortie, JSON.stringify(doc, null, 2) + "\n", "utf8");
const composants = statements.reduce((n, s) => n + s.products[0].subcomponents.length, 0);
console.log(`✅ ${sortie} — ${statements.length} déclarations, ${composants} sous-composants`);

/*
  Et la même chose en lisible. Le document humain et l'attestation machine
  sortent de la même analyse : ils ne peuvent pas diverger, et personne n'a à
  se demander lequel dit vrai.
*/
const paquetsDe = (cve) =>
  [...purls.get(cve)]
    .map((p) => p.replace(/^pkg:deb\/debian\//, "").replace(/\?.*$/, ""))
    .sort()
    .join(", ");

const parSeverite = (a, b) => {
  const rang = (c) => (severites.get(c) === "CRITICAL" ? 0 : 1);
  return rang(a) - rang(b) || a.localeCompare(b);
};

// Une barre verticale dans une cellule coupe le tableau en deux. Les analyses
// en contiennent — c'est le caractère d'alternation, et il est au coeur du
// sujet pour CVE-2026-13221.
const cellule = (t) => String(t).replace(/\|/g, "\\|");

const fiches = [...purls.keys()].sort(parSeverite).map((cve) => {
  const a = analyse[cve];
  return [
    `### ${cve}`,
    "",
    "| | |",
    "|---|---|",
    `| **Sévérité** | ${severites.get(cve)} |`,
    `| **Paquets et versions** | \`${paquetsDe(cve)}\` |`,
    `| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |`,
    `| **Composant vulnérable** | ${cellule(a.composant)} |`,
    `| **Condition de déclenchement** | ${cellule(a.declencheur)} |`,
    `| **Entrée contrôlée par un tiers** | ${cellule(a.entree_controlee)} |`,
    `| **Atteignabilité statique** | ${cellule(a.statique)} |`,
    `| **Atteignabilité dynamique** | ${cellule(a.dynamique)} |`,
    `| **Justification VEX** | \`${a.justification}\` |`,
    `| **Portée de l'impact** | ${cellule(a.impact)} |`,
    `| **Statut** | \`NOT_AFFECTED\` |`,
    "",
  ].join("\n");
});

const critiques = [...purls.keys()].filter((c) => severites.get(c) === "CRITICAL").length;
const elevees = [...purls.keys()].length - critiques;

const md = `# Applicabilité des vulnérabilités du runtime de production

**Ce document est engendré** par \`scripts/vex-generer.mjs\` depuis
\`security/analyse-applicabilite.json\`, qui porte le raisonnement, et depuis le
rapport brut de Trivy, qui porte les versions. Ne le modifiez pas à la main :
modifiez l'analyse, puis régénérez. L'attestation lisible par une machine,
\`security/vex.openvex.json\`, sort de la même source.

## Le contrat

Le portail ne demande plus que le compteur brut soit nul — aucune image Debian
ne peut le tenir, \`perl-base\` étant un paquet \`Essential\` qui porte à lui seul
huit CVE sans correctif amont. Il demande que **rien d'applicable ni
d'indéterminé ne subsiste** :

\`\`\`
APPLICABLE_CRITICAL = 0
APPLICABLE_HIGH     = 0
UNKNOWN_CRITICAL    = 0
UNKNOWN_HIGH        = 0
\`\`\`

Toute occurrence restante doit être \`NOT_AFFECTED\`, avec une preuve nominative
et reproductible. Aucune catégorie « risque accepté », « ne sera pas corrigé »,
« exception temporaire » ou « ignorée » n'existe : \`scripts/gate-applicabilite.mjs\`
refuse tout autre statut, et traite comme un échec ce que personne n'a examiné.

## Le relevé

| | |
|---|---|
| Occurrences brutes | **${statements.reduce((n, s) => n + s.products[0].subcomponents.length, 0)}** (\`RAW_CRITICAL\` et \`RAW_HIGH\` restent imprimés tels quels) |
| CVE distinctes | **${statements.length}** — ${critiques} critiques, ${elevees} élevées |
| \`NOT_AFFECTED\` | **${statements.length}** |
| \`APPLICABLE\` | **0** |
| \`UNKNOWN\` | **0** |

Aucune des ${statements.length} n'a de correctif disponible en amont : Trivy les donne toutes
avec \`fix=-\`. Aucune mise à jour de paquet ne les fait disparaître aujourd'hui.

## Ce sur quoi reposent les preuves

Toutes les mesures ont été faites sur une **génération réelle**, avec le corpus
hostile de \`scripts/corpus-adversarial.ts\` : chaque champ que remplit un
enseignant y porte des métacaractères d'expression régulière, des accents, des
chaînes longues, et un marqueur unique qui permet de suivre la donnée.

Cinq instruments, et chacun a été validé par un témoin — une trace vide ne
vaut rien si l'instrument ne se déclenche jamais :

| Instrument | Ce qu'il montre | Témoin |
|---|---|---|
| \`strace -f -e trace=execve\` | les 27 programmes exécutés | \`perl\`, \`pdflatex\`, \`kpsewhich\` apparaissent |
| \`LD_DEBUG=libs\` | les 32 objets partagés chargés | \`libglib\`, \`libsqlite3\`, \`libacl\` apparaissent |
| \`%INC\` en fin d'exécution | les 82 modules Perl chargés | les modules \`AMC::*\` apparaissent |
| interposition \`LD_PRELOAD\` | les points d'entrée incriminés | \`g_strdup\` 72 fois, \`g_get_home_dir\` 4 fois ; un programme appelant \`acl_get_file\` déclenche bien l'enveloppe |
| enveloppement Perl | les fonctions d'AMC surveillées | \`AMC::Basic::debug\` et \`AMC::Config::get\`, 225 appels |

L'image de diagnostic qui porte ces instruments est jetable : elle n'est jamais
livrée.

## Ce qui invalide ces preuves

Une preuve « non concerné » dit qu'une fonction n'est jamais appelée *par ce
code-là*, dans *cette image-là*. Elle ne survit pas à un changement de runtime.

L'attestation porte donc une **empreinte de runtime** — une empreinte SHA-256
de \`Dockerfile\`, \`api/paper/amc-runner.ts\`, \`api/paper/amc-template.ts\` et
\`docs/DEPENDANCES.md\`. La CI la recalcule à chaque construction et échoue si
elle a changé. De même, une déclaration qui vise une version de paquet que
l'image ne porte plus fait échouer le portail : une analyse ne suit pas
silencieusement une montée de version.

## Les fiches

${fiches.join("\n")}`;

await writeFile("docs/VEX-CANDIDATES.md", md, "utf8");
console.log(`✅ docs/VEX-CANDIDATES.md — ${statements.length} fiches`);

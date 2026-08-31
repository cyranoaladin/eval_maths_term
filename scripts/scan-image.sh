#!/usr/bin/env bash
#
# scripts/scan-image.sh
#
# La vue brute des vulnérabilités de l'image. **Ce script ne décide plus.**
#
# Il a longtemps porté le seuil, et l'a porté de deux façons successivement
# fausses. D'abord « zéro vulnérabilité *corrigeable* » : une faille sans
# correctif amont était écartée, ce qui revient à accepter ce qu'on ne sait pas
# réparer. Puis « zéro, sans exception » : un seuil que le contrat exigeait mais
# qu'aucune image Debian ne peut tenir, `perl-base` étant un paquet Essential
# qui porte à lui seul huit CVE sans correctif.
#
# Les deux seuils posaient la mauvaise question. La bonne est :
#
#   cette vulnérabilité est-elle atteignable dans cet artefact-ci ?
#
# Elle se tranche par `scripts/gate-applicabilite.mjs`, qui croise ce rapport,
# la nomenclature de l'image et l'attestation VEX, et qui échoue sur toute
# vulnérabilité applicable ou seulement indéterminée.
#
# Ce script-ci produit le rapport et imprime les compteurs bruts, entiers, sans
# filtre ni exclusion. C'est ce que le portail examinera ensuite.
#
#   bash scripts/scan-image.sh [image] [rapport.json]
#
# Sortie 0 : le rapport a été produit. Sortie 1 : l'analyse a échoué.
set -uo pipefail

IMAGE="${1:-atelier-qcm:production}"
TRIVY="aquasec/trivy:0.69.1@sha256:1c78ed1ef824ab8bb05b04359d186e4c1229d0b3e67005faacb54a7d71974f73"
CACHE="${HOME}/.cache/trivy"
RAPPORT="${2:-${RAPPORT_SCAN:-rapport-trivy.json}}"
mkdir -p "$CACHE"

echo "▶ Analyse de $IMAGE"

# L'empreinte de l'image analysée : c'est elle qui doit se retrouver au
# déploiement, pas une reconstruction ultérieure.
EMPREINTE="$(docker image inspect "$IMAGE" --format '{{.Id}}' 2>/dev/null || echo inconnue)"
echo "  empreinte : $EMPREINTE"

docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$CACHE:/root/.cache/trivy" \
  "$TRIVY" image --scanners vuln --severity HIGH,CRITICAL --quiet \
  --format json "$IMAGE" > "$RAPPORT" 2>/dev/null

if [ ! -s "$RAPPORT" ]; then
  echo "✗ L'analyse n'a produit aucun rapport."
  exit 1
fi

node -e '
const rapport = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const toutes = (rapport.Results ?? []).flatMap((r) => r.Vulnerabilities ?? []);
const critiques = toutes.filter((v) => v.Severity === "CRITICAL");
const elevees = toutes.filter((v) => v.Severity === "HIGH");

const ligne = (v) =>
  `  ${v.Severity.padEnd(9)} ${v.PkgName} ${v.InstalledVersion}` +
  (v.FixedVersion ? ` → ${v.FixedVersion}` : "  (aucun correctif amont)") +
  `  ${v.VulnerabilityID}`;

if (toutes.length === 0) {
  console.log("\naucune vulnérabilité élevée ou critique");
} else {
  console.log(`\nRelevé brut (${toutes.length} occurrences, ${new Set(toutes.map(v => v.VulnerabilityID)).size} CVE distinctes) :`);
  for (const v of [...critiques, ...elevees]) console.log(ligne(v));
}
console.log(`\nRAW_CRITICAL = ${critiques.length}`);
console.log(`RAW_HIGH = ${elevees.length}`);
' "$RAPPORT"

echo
echo "   rapport : $RAPPORT"
echo "   Le verdict appartient à scripts/gate-applicabilite.mjs."

#!/usr/bin/env bash
#
# scripts/scan-image.sh
#
# Analyse de vulnérabilités de l'image de production.
#
# Le seuil est « aucune vulnérabilité élevée ou critique **pour laquelle un
# correctif existe** ». C'est le seul critère sur lequel on puisse agir : une
# faille sans correctif amont ne se répare pas en la déclarant inacceptable.
# Elles sont listées quand même, pour qu'on sache ce qu'on porte — et le jour où
# un correctif paraît, la porte se ferme d'elle-même.
#
#   bash scripts/scan-image.sh [image]
set -uo pipefail

IMAGE="${1:-atelier-qcm:production}"
TRIVY="aquasec/trivy:0.69.1"
CACHE="${HOME}/.cache/trivy"
RAPPORT="$(mktemp)"
trap 'rm -f "$RAPPORT"' EXIT
mkdir -p "$CACHE"

echo "▶ Analyse de $IMAGE"

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
const corrigeables = toutes.filter((v) => v.FixedVersion);
const portees = toutes.filter((v) => !v.FixedVersion);

const ligne = (v) =>
  `  ${v.Severity.padEnd(9)} ${v.PkgName} ${v.InstalledVersion}` +
  (v.FixedVersion ? ` → ${v.FixedVersion}` : "") + `  ${v.VulnerabilityID}`;

console.log(`\nSans correctif amont — portées, surveillées (${portees.length}) :`);
for (const v of portees) console.log(ligne(v));

console.log(`\nCorrigeables — le gate (${corrigeables.length}) :`);
for (const v of corrigeables) console.log(ligne(v));

process.exit(corrigeables.length === 0 ? 0 : 1);
' "$RAPPORT"
code=$?

echo
if [ $code -eq 0 ]; then
  echo "✅ Aucune vulnérabilité élevée ou critique corrigeable."
else
  echo "❌ Des correctifs existent et ne sont pas appliqués."
fi
exit $code

#!/usr/bin/env bash
#
# scripts/scan-image.sh
#
# Analyse de vulnérabilités de l'image de production.
#
# Le seuil est **zéro vulnérabilité élevée ou critique**. Sans exception, et
# notamment sans l'exception qui figurait ici : « celles pour lesquelles aucun
# correctif amont n'existe sont portées et surveillées ». Une faille sans
# correctif reste une faille dans l'image qui sert des copies d'élèves ; ce qui
# manque, c'est un correctif, pas une raison de l'accepter.
#
# Quand une vulnérabilité apparaît sans correctif disponible, les issues sont :
# changer d'image de base, mettre le paquet à jour depuis une autre source,
# retirer le composant s'il n'est pas nécessaire — ou tenir l'artefact bloqué.
#
#   bash scripts/scan-image.sh [image]
#
# Sortie 0 : aucune HIGH ni CRITICAL. Sortie 1 : au moins une, listée.
set -uo pipefail

IMAGE="${1:-atelier-qcm:production}"
TRIVY="aquasec/trivy:0.69.1@sha256:1c78ed1ef824ab8bb05b04359d186e4c1229d0b3e67005faacb54a7d71974f73"
CACHE="${HOME}/.cache/trivy"
RAPPORT="${RAPPORT_SCAN:-$(mktemp)}"
GARDER_RAPPORT="${RAPPORT_SCAN:-}"
[ -z "$GARDER_RAPPORT" ] && trap 'rm -f "$RAPPORT"' EXIT
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
  console.log(`\nÀ traiter (${toutes.length}) :`);
  for (const v of [...critiques, ...elevees]) console.log(ligne(v));
}
console.log(`\nIMAGE_CRITICAL = ${critiques.length}`);
console.log(`IMAGE_HIGH = ${elevees.length}`);
process.exit(toutes.length === 0 ? 0 : 1);
' "$RAPPORT"
code=$?

echo
if [ $code -eq 0 ]; then
  echo "✅ IMAGE_HIGH = 0 · IMAGE_CRITICAL = 0"
else
  echo "❌ L'image porte des vulnérabilités élevées ou critiques."
  echo "   Aucune n'est acceptable, avec ou sans correctif amont."
fi
[ -n "$GARDER_RAPPORT" ] && echo "   rapport : $RAPPORT"
exit $code

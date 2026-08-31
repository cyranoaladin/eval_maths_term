#!/usr/bin/env bash
#
# scripts/sbom-image.sh
#
# Nomenclature logicielle de l'image, liée à l'image.
#
# `npm run sbom` ne décrit que les dépendances npm : il ignore Debian, TeX Live
# et AMC, c'est-à-dire l'essentiel de ce qui porte des vulnérabilités. Et il
# décrit un arbre de dépendances, pas un artefact — rien n'y rattache la
# nomenclature à l'image qui part en production.
#
# Ce script inventorie l'image elle-même, et inscrit son empreinte dans le
# document. Une nomenclature qui ne dit pas de quoi elle parle ne sert à rien
# le jour où il faut répondre « cette image-là contenait-elle ce paquet ? ».
#
#   bash scripts/sbom-image.sh [image] [fichier]
set -uo pipefail

IMAGE="${1:-atelier-qcm:production}"
SORTIE="${2:-sbom-image.json}"
TRIVY="aquasec/trivy:0.69.1@sha256:1c78ed1ef824ab8bb05b04359d186e4c1229d0b3e67005faacb54a7d71974f73"
CACHE="${HOME}/.cache/trivy"
mkdir -p "$CACHE"

EMPREINTE="$(docker image inspect "$IMAGE" --format '{{.Id}}' 2>/dev/null)" \
  || { echo "✗ image introuvable : $IMAGE" >&2; exit 1; }

echo "▶ Nomenclature de $IMAGE"
echo "  empreinte : $EMPREINTE"

docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$CACHE:/root/.cache/trivy" \
  "$TRIVY" image --quiet --format cyclonedx "$IMAGE" > "$SORTIE" 2>/dev/null

[ -s "$SORTIE" ] || { echo "✗ nomenclature vide" >&2; exit 1; }

# L'empreinte, dans le document, sous une propriété qu'on peut relire.
node -e '
const fs = require("node:fs");
const [fichier, image, empreinte] = process.argv.slice(1);
const doc = JSON.parse(fs.readFileSync(fichier, "utf8"));
doc.metadata ??= {};
doc.metadata.properties = [
  ...(doc.metadata.properties ?? []).filter((p) => !p.name?.startsWith("atelier:image")),
  { name: "atelier:image:ref", value: image },
  { name: "atelier:image:id", value: empreinte },
];
fs.writeFileSync(fichier, JSON.stringify(doc, null, 2));
const n = (doc.components ?? []).length;
console.log(`  ${n} composants inventoriés`);
console.log(`SBOM_IMAGE_ID = ${empreinte}`);
' "$SORTIE" "$IMAGE" "$EMPREINTE"

echo "✅ $SORTIE"

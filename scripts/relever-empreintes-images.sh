#!/usr/bin/env bash
#
# scripts/relever-empreintes-images.sh
#
# Met à jour l'empreinte de l'image de base épinglée dans le `Dockerfile`.
#
# Les étiquettes mentent avec le temps : `node:22-trixie-slim` désigne une image
# différente chaque semaine, et deux constructions du même commit doivent
# produire la même chose. L'empreinte est donc figée — et remontée à la main,
# quand on le décide, pas quand l'amont publie.
#
# Le script montre l'écart et demande confirmation. Après acceptation :
# reconstruire, relancer la recette, et refaire passer le scan de l'image.
#
#   bash scripts/relever-empreintes-images.sh
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERFILE="$RACINE/Dockerfile"
ETIQUETTE="node:22-trixie-slim"

actuelle=$(grep -oP 'ARG NODE_IMAGE=node@\Ksha256:[0-9a-f]+' "$DOCKERFILE")
echo "Empreinte épinglée : $actuelle"

echo "Interrogation de $ETIQUETTE…"
docker pull -q "$ETIQUETTE" >/dev/null
nouvelle=$(docker inspect --format='{{index .RepoDigests 0}}' "$ETIQUETTE" | sed 's/.*@//')
echo "Empreinte publiée  : $nouvelle"

if [ "$actuelle" = "$nouvelle" ]; then
  echo "✓ Rien à faire : l'épinglage est à jour."
  exit 0
fi

echo
echo "L'amont a publié une nouvelle image. Ce que cela change n'est pas visible"
echo "d'ici : reconstruisez, relancez la recette, refaites passer le scan."
read -r -p "Épingler la nouvelle empreinte ? [o/N] " reponse
case "$reponse" in
  o|O|oui|OUI) ;;
  *) echo "Abandonné. L'empreinte reste $actuelle."; exit 0 ;;
esac

sed -i "s|ARG NODE_IMAGE=node@sha256:[0-9a-f]*|ARG NODE_IMAGE=node@$nouvelle|" "$DOCKERFILE"
echo "✓ Dockerfile mis à jour."
echo
echo "  docker build -t atelier-qcm:verification ."
echo "  bash scripts/recette-docker.sh"
echo "  bash scripts/scan-image.sh atelier-qcm:verification"

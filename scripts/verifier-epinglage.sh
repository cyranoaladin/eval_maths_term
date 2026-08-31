#!/usr/bin/env bash
#
# scripts/verifier-epinglage.sh
#
# Rien de ce qui entre dans un artefact ou dans un gate ne doit être désigné par
# une étiquette. `@v7` se déplace ; une empreinte non. Ce contrôle échoue si une
# action GitHub ou une image du gate est désignée autrement que par empreinte.
#
#   bash scripts/verifier-epinglage.sh
set -uo pipefail

echecs=0
signaler() { echo "  ✗ $1"; echecs=$((echecs + 1)); }

echo "▶ Épinglage des dépendances de construction et de gate"

# ── Actions GitHub ───────────────────────────────────────────────────────────
mutables=$(grep -rnE '^\s*(- )?uses: [^@]+@(v?[0-9]+(\.[0-9]+)*|main|master|latest)\s*$' .github/workflows/ 2>/dev/null || true)
if [ -n "$mutables" ]; then
  while IFS= read -r ligne; do signaler "action par étiquette — $ligne"; done <<< "$mutables"
else
  echo "  ✓ toutes les actions sont épinglées par empreinte"
fi

# ── Images exécutées par la construction, les recettes ou les mesures ────────
#
# On cherche les images connues sans `@sha256:` juste après. Les fichiers de
# documentation sont exclus : ils citent des images, ils n'en exécutent pas.
IMAGES="mysql:8\.4 mcr\.microsoft\.com/playwright: aquasec/trivy: grafana/k6 ghcr\.io/gitleaks/gitleaks"
for motif in $IMAGES; do
  trouvees=$(grep -rnE "$motif" \
    --include='*.yml' --include='*.yaml' --include='*.sh' --include='package.json' --include='Dockerfile' \
    . 2>/dev/null | grep -v node_modules | grep -v '/docs/' | grep -v 'verifier-epinglage' || true)
  while IFS= read -r ligne; do
    [ -z "$ligne" ] && continue
    case "$ligne" in
      *"@sha256:"*) ;;
      *) signaler "image par étiquette — ${ligne:0:120}" ;;
    esac
  done <<< "$trouvees"
done
[ "$echecs" -eq 0 ] && echo "  ✓ toutes les images du gate sont épinglées par empreinte"

# ── Image de base du Dockerfile ──────────────────────────────────────────────
if grep -qE '^ARG NODE_IMAGE=.*@sha256:' Dockerfile; then
  echo "  ✓ l'image de base est épinglée par empreinte"
else
  signaler "l'image de base du Dockerfile n'est pas épinglée par empreinte"
fi

echo
if [ "$echecs" -eq 0 ]; then
  echo "✓ MUTABLE_CRITICAL_ACTIONS = 0 · MUTABLE_RELEASE_IMAGES = 0"
  exit 0
fi
echo "✗ $echecs entrée(s) mutable(s). Voir docs/DEPENDANCES.md." >&2
exit 1

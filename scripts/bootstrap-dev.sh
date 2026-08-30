#!/usr/bin/env bash
#
# scripts/bootstrap-dev.sh — prépare une machine de développement.
#
# Fabrique un `.env` propre à cette machine : secrets de session, secret
# applicatif et mots de passe MySQL sont tirés au hasard localement. Rien de ce
# qui ouvre une session ou une base n'est écrit dans le dépôt — un secret né
# dans un dépôt est un secret public, et l'application refuse de démarrer en
# production avec une valeur de remplissage.
#
#   scripts/bootstrap-dev.sh            # crée .env s'il n'existe pas
#   scripts/bootstrap-dev.sh --force    # le remplace, après sauvegarde
#
# Ensuite :
#   docker compose -f docker-compose.dev.yml up -d
#   npx tsx db/migrate.ts && npx tsx db/seed.ts
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CIBLE="$RACINE/.env"
FORCE="${1:-}"

if [[ -f "$CIBLE" && "$FORCE" != "--force" ]]; then
  echo "✓ $CIBLE existe déjà — rien n'est écrasé."
  echo "  Pour le régénérer : scripts/bootstrap-dev.sh --force"
  exit 0
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "✗ openssl est requis pour tirer des secrets au hasard." >&2
  exit 1
fi

if [[ -f "$CIBLE" ]]; then
  SAUVEGARDE="$CIBLE.$(date +%Y%m%d%H%M%S).bak"
  cp "$CIBLE" "$SAUVEGARDE"
  echo "→ ancien fichier sauvegardé dans $(basename "$SAUVEGARDE")"
fi

# `base64` produit des « / » et des « + » : illisibles dans une URL de
# connexion. Les mots de passe de base sont donc hexadécimaux.
secret() { openssl rand -base64 48 | tr -d '\n'; }
motdepasse() { openssl rand -hex 24 | tr -d '\n'; }

MYSQL_ROOT_PASSWORD="$(motdepasse)"
MYSQL_PASSWORD="$(motdepasse)"

cat > "$CIBLE" <<ENV
# Développement local — généré par scripts/bootstrap-dev.sh le $(date -Iseconds).
#
# Ces valeurs sont propres à cette machine et ignorées par Git. Ne les
# recopiez nulle part : régénérez-en avec le script.
NODE_ENV=development
PORT=3000

# ── Base de données ────────────────────────────────────────────
# Les deux mots de passe alimentent docker-compose.dev.yml, qui n'en contient
# aucun en clair.
MYSQL_ROOT_PASSWORD=$MYSQL_ROOT_PASSWORD
MYSQL_DATABASE=eval_maths
MYSQL_USER=eval
MYSQL_PASSWORD=$MYSQL_PASSWORD
DATABASE_URL=mysql://eval:$MYSQL_PASSWORD@127.0.0.1:3307/eval_maths

# Base des tests d'intégration : même serveur, schéma distinct.
TEST_DATABASE_URL=mysql://root:$MYSQL_ROOT_PASSWORD@127.0.0.1:3307/eval_maths_test

# ── Secrets de session ─────────────────────────────────────────
APP_ID=dev_app
APP_SECRET=$(secret)
TEACHER_SESSION_SECRET=$(secret)
STUDENT_SESSION_SECRET=$(secret)

# ── OAuth Kimi ─────────────────────────────────────────────────
# Valeurs factices : la connexion enseignant ne fonctionnera pas tant que de
# vraies URL ne sont pas fournies. Utilisez scripts/dev-session.ts pour
# obtenir une session enseignant en local.
KIMI_AUTH_URL=http://localhost:9999
KIMI_OPEN_URL=http://localhost:9998
VITE_KIMI_AUTH_URL=http://localhost:9999
VITE_APP_ID=dev_app
OWNER_UNION_ID=

# ── Correction assistée par LLM ────────────────────────────────
# Sans clé, les réponses ouvertes sont marquées « à corriger manuellement ».
# Les valeurs par défaut vivent dans api/lib/env.ts.
LLM_API_KEY=

# ── Divers ─────────────────────────────────────────────────────
ALLOWED_ORIGINS=http://localhost:3000
LOG_LEVEL=info
ENV

chmod 600 "$CIBLE"

echo "✓ $CIBLE écrit — secrets tirés localement, jamais versionnés."
echo
echo "  docker compose -f docker-compose.dev.yml up -d"
echo "  npx tsx db/migrate.ts && npx tsx db/seed.ts"

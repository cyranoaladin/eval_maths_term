#!/usr/bin/env bash
#
# scripts/migration-production.sh
#
# Migrer une base qui porte de vraies copies.
#
# L'ordre n'est pas négociable : sauvegarde vérifiée, puis préflights, puis
# migration, puis postflight. Chaque étape peut arrêter la suivante, et un
# arrêt laisse la base exactement dans l'état où elle était — les migrations ne
# suppriment jamais de donnée ambiguë, elles refusent de s'appliquer.
#
# Usage :
#   DATABASE_URL=mysql://user:pass@hote:port/base \
#   PAPER_OUTPUT_DIR=/var/lib/atelier/tirages \
#   bash scripts/migration-production.sh [dossier de sauvegarde]
#
# Codes de sortie :
#   0  migration appliquée et vérifiée
#   1  arrêt : une étape a refusé de poursuivre. La base n'a pas été modifiée,
#      sauf si l'arrêt vient du postflight — le message le dit alors.
set -euo pipefail

DESTINATION="${1:-./sauvegardes}"
URL="${DATABASE_URL:?DATABASE_URL est requise}"

etape() { echo; echo "── $1 ──"; }
arret() { echo; echo "✗ ARRÊT : $1" >&2; exit 1; }

# Décomposition de l'URL : le client MySQL est appelé par conteneur, sans
# supposer qu'un client soit installé sur la machine de déploiement.
sans_schema="${URL#mysql://}"
identifiants="${sans_schema%%@*}"
reste="${sans_schema#*@}"
UTILISATEUR="${identifiants%%:*}"
MOT_DE_PASSE="${identifiants#*:}"
hote_port="${reste%%/*}"
HOTE="${hote_port%%:*}"
PORT="${hote_port#*:}"
[ "$PORT" = "$HOTE" ] && PORT=3306
BASE="${reste#*/}"
BASE="${BASE%%\?*}"
IMAGE_MYSQL="${IMAGE_MYSQL:-mysql:8.4@sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb}"

compter_migrations() {
  docker run --rm --network host -e MYSQL_PWD="$MOT_DE_PASSE" "$IMAGE_MYSQL" \
    mysql --host="$HOTE" --port="$PORT" --user="$UTILISATEUR" -N -B "$BASE" \
    -e "select count(*) from \`__drizzle_migrations\`" 2>/dev/null || echo 0
}

echo "▶ Migration de production"
echo "  base : $BASE"

# ── 1. Sauvegarde, et vérification qu'elle est exploitable ───────────────────
etape "1/5 · sauvegarde"
SAUVEGARDE="$(bash scripts/sauvegarde.sh "$DESTINATION" | tail -1)" \
  || arret "la sauvegarde a échoué. Rien n'a été migré."
echo "  sauvegarde : $SAUVEGARDE"

# ── 2. État avant ────────────────────────────────────────────────────────────
etape "2/5 · état avant"
AVANT="$(compter_migrations)"
echo "  migrations appliquées : $AVANT"

# ── 3. Préflights ────────────────────────────────────────────────────────────
#
# Ils ne modifient rien. Chacun répond à une question que la migration va poser
# à la base, et à laquelle il vaut mieux répondre maintenant qu'au milieu d'un
# ordre ALTER.
etape "3/5 · préflights"
for controle in \
  scripts/preflight-unicite-reponses.ts \
  scripts/preflight-acces-enseignant.ts \
  scripts/preflight-incidents-json.ts \
  scripts/preflight-invariants.ts
do
  echo "  · $(basename "$controle")"
  if ! DATABASE_URL="$URL" npx tsx "$controle"; then
    arret "« $(basename "$controle") » a relevé une divergence. La base n'a pas été modifiée.
        Aucune correction automatique n'est appliquée : la décision revient à un opérateur."
  fi
done

# ── 4. Migration ─────────────────────────────────────────────────────────────
etape "4/5 · migration"
DATABASE_URL="$URL" node dist/migrate.js \
  || arret "la migration a échoué. La base est dans l'état d'avant l'ordre fautif ;
        restaurez $SAUVEGARDE si le doute subsiste."

# ── 5. Postflight ────────────────────────────────────────────────────────────
#
# Deux questions : le journal a-t-il avancé, et les invariants tiennent-ils
# maintenant que la base les fait respecter ?
etape "5/5 · postflight"
APRES="$(compter_migrations)"
echo "  migrations appliquées : $AVANT → $APRES"

if [ "$APRES" -lt "$AVANT" ]; then
  arret "le journal des migrations a reculé. État incohérent : restaurez $SAUVEGARDE."
fi

if ! DATABASE_URL="$URL" npx tsx scripts/preflight-invariants.ts; then
  echo
  echo "✗ ARRÊT : les invariants ne tiennent pas après migration." >&2
  echo "        La base A été modifiée. Restaurez $SAUVEGARDE avant de rouvrir le service." >&2
  exit 1
fi

echo
echo "✓ Migration appliquée et vérifiée."
echo "  sauvegarde préalable : $SAUVEGARDE"
echo "  à conserver jusqu'à ce qu'une épreuve complète ait eu lieu sur ce schéma."

#!/usr/bin/env bash
#
# scripts/sauvegarde.sh
#
# Sauvegarde complète : la base et les tirages papier.
#
# Deux jeux de données ne se reconstruisent pas. La base porte les copies, les
# notes et le journal des interventions manuelles. Le dossier des tirages porte
# les sujets et les corrigés produits par AMC — et le sujet distribué à une
# classe ne se régénère pas à l'identique, puisque la composition d'une
# évaluation peut avoir changé depuis.
#
# Les deux sont pris ensemble, dans la même archive horodatée, avec une
# empreinte : une sauvegarde dont on ne peut pas vérifier l'intégrité ne vaut
# pas mieux qu'une absence de sauvegarde.
#
# Usage :
#   DATABASE_URL=mysql://user:pass@hote:port/base \
#   PAPER_OUTPUT_DIR=./.paper-exams \
#   bash scripts/sauvegarde.sh [dossier de destination]
#
# La base est lue en une seule transaction (`--single-transaction`) : aucune
# table n'est verrouillée, une épreuve en cours n'est pas interrompue, et le
# cliché est cohérent d'un bout à l'autre.
set -euo pipefail

DESTINATION="${1:-./sauvegardes}"
URL="${DATABASE_URL:?DATABASE_URL est requise}"
TIRAGES="${PAPER_OUTPUT_DIR:-./.paper-exams}"
IMAGE_MYSQL="${IMAGE_MYSQL:-mysql:8.4@sha256:b3b90af2a6552ae30c266fdb7d5dd55f3afb72404bb78d37fe8a23eb857fd3fb}"

# Décomposition de l'URL sans dépendre d'un outil externe.
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

HORODATAGE="$(date -u +%Y%m%dT%H%M%SZ)"
DOSSIER="$DESTINATION/$HORODATAGE"
mkdir -p "$DOSSIER"

echo "▶ Sauvegarde de « $BASE » vers $DOSSIER"

# ── 1. La base ───────────────────────────────────────────────────────────────
# `--single-transaction` : cliché cohérent sans verrou.
# `--routines --events --triggers` : rien du schéma ne reste au sol.
# `--set-gtid-purged=OFF` : l'archive doit pouvoir être rejouée sur une autre
#   instance que celle qui l'a produite, y compris un serveur de recette.
docker run --rm --network host -e MYSQL_PWD="$MOT_DE_PASSE" "$IMAGE_MYSQL" \
  mysqldump \
    --host="$HOTE" --port="$PORT" --user="$UTILISATEUR" \
    --single-transaction --routines --events --triggers \
    --set-gtid-purged=OFF --column-statistics=0 --no-tablespaces \
    "$BASE" \
  | gzip -9 > "$DOSSIER/base.sql.gz"

echo "  base       : $(du -h "$DOSSIER/base.sql.gz" | cut -f1)"

# Une archive qui s'ouvre et qui contient les treize tables. Sans ce contrôle,
# une sauvegarde tronquée passe inaperçue jusqu'au jour où on en a besoin.
# Le journal du migrateur en fait partie : restaurée sans lui, la base
# rejouerait toutes les migrations depuis le début.
TABLES_ATTENDUES="__drizzle_migrations answer_drafts cheat_events classes evaluations grade_audit paper_copies paper_exams questions responses sessions students users"
CONTENU="$(gzip -dc "$DOSSIER/base.sql.gz")"
for table in $TABLES_ATTENDUES; do
  if ! grep -q "CREATE TABLE \`$table\`" <<< "$CONTENU"; then
    echo "✗ La sauvegarde ne contient pas la table « $table » : archive incomplète." >&2
    exit 1
  fi
done
LIGNES="$(grep -c "^INSERT INTO" <<< "$CONTENU" || true)"
echo "  contrôle   : 13 tables présentes, $LIGNES ordre(s) d'insertion"

# ── 2. Les tirages ───────────────────────────────────────────────────────────
if [ -d "$TIRAGES" ]; then
  tar -czf "$DOSSIER/tirages.tar.gz" -C "$(dirname "$TIRAGES")" "$(basename "$TIRAGES")"
  echo "  tirages    : $(du -h "$DOSSIER/tirages.tar.gz" | cut -f1)"
else
  # Un dossier absent est une information, pas une erreur : une installation
  # sans impression n'en a pas. On l'écrit pour que la restauration le sache.
  echo "  tirages    : dossier absent ($TIRAGES)"
fi

# ── 3. Le manifeste ──────────────────────────────────────────────────────────
{
  echo "horodatage=$HORODATAGE"
  echo "base=$BASE"
  echo "hote=$HOTE:$PORT"
  echo "tirages=$TIRAGES"
  echo "version_application=$(node -p "require('./package.json').version" 2>/dev/null || echo inconnue)"
  echo "empreinte_git=$(git rev-parse HEAD 2>/dev/null || echo inconnue)"
} > "$DOSSIER/manifeste.txt"

( cd "$DOSSIER" && sha256sum ./*.gz > empreintes.sha256 )

echo "  manifeste  : $DOSSIER/manifeste.txt"
echo "  empreintes : $DOSSIER/empreintes.sha256"
echo "✓ Sauvegarde terminée : $DOSSIER"
echo "$DOSSIER"

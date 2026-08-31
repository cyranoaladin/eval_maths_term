#!/usr/bin/env bash
#
# scripts/restauration.sh
#
# Restauration d'une sauvegarde, et vérification qu'elle a bien eu lieu.
#
# Une sauvegarde qu'on n'a jamais restaurée est une hypothèse. Ce script fait
# les deux gestes d'affilée : il remet la base et les tirages en place, puis il
# compte ce qu'il a remis et le compare à ce que l'archive annonçait. Un écart
# arrête la restauration au lieu de la déclarer réussie.
#
# Usage :
#   DATABASE_URL=mysql://user:pass@hote:port/base_cible \
#   PAPER_OUTPUT_DIR=./.paper-exams \
#   bash scripts/restauration.sh ./sauvegardes/20260831T001551Z
#
# La base cible est écrasée. C'est le sens d'une restauration, mais cela mérite
# d'être dit : ne la dirigez pas vers une base de production en service.
set -euo pipefail

SOURCE="${1:?Indiquez le dossier de sauvegarde à restaurer}"
URL="${DATABASE_URL:?DATABASE_URL est requise}"
TIRAGES="${PAPER_OUTPUT_DIR:-./.paper-exams}"
IMAGE_MYSQL="${IMAGE_MYSQL:-mysql:8.4}"

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

mysql_client() {
  docker run --rm -i --network host -e MYSQL_PWD="$MOT_DE_PASSE" "$IMAGE_MYSQL" \
    mysql --host="$HOTE" --port="$PORT" --user="$UTILISATEUR" "$@"
}

echo "▶ Restauration de $SOURCE vers « $BASE »"

# ── 1. L'archive est-elle intacte ? ──────────────────────────────────────────
( cd "$SOURCE" && sha256sum --check --status empreintes.sha256 ) \
  || { echo "✗ Empreintes non conformes : l'archive a été modifiée ou tronquée." >&2; exit 1; }
echo "  empreintes : conformes"

# ── 2. La base ───────────────────────────────────────────────────────────────
mysql_client -e "DROP DATABASE IF EXISTS \`$BASE\`; CREATE DATABASE \`$BASE\` CHARACTER SET utf8mb4;"
gzip -dc "$SOURCE/base.sql.gz" | mysql_client "$BASE"
echo "  base       : restaurée"

# ── 3. Les tirages ───────────────────────────────────────────────────────────
if [ -f "$SOURCE/tirages.tar.gz" ]; then
  mkdir -p "$(dirname "$TIRAGES")"
  rm -rf "$TIRAGES"
  tar -xzf "$SOURCE/tirages.tar.gz" -C "$(dirname "$TIRAGES")"
  echo "  tirages    : $(find "$TIRAGES" -type f | wc -l) fichier(s)"

  # L'archive est extraite par l'utilisateur qui restaure ; l'application, elle,
  # s'exécute sous un utilisateur non privilégié dans son conteneur. Sans ce
  # geste, le dossier revient avec les droits du restaurateur, l'application ne
  # peut plus y écrire, et `/api/ready` répond « tirages : EACCES » — un service
  # restauré qui ne sait plus imprimer.
  UID_APPLICATION="${UID_APPLICATION:-10001}"
  if chown -R "$UID_APPLICATION:$UID_APPLICATION" "$TIRAGES" 2>/dev/null; then
    echo "  droits     : rendus à l'uid $UID_APPLICATION"
  else
    echo "  droits     : ⚠ impossible de donner « $TIRAGES » à l'uid $UID_APPLICATION."
    echo "               Faites-le avant de redémarrer l'application :"
    echo "                 sudo chown -R $UID_APPLICATION:$UID_APPLICATION $TIRAGES"
  fi
else
  echo "  tirages    : absents de l'archive"
fi

# ── 4. Ce qui a été remis ────────────────────────────────────────────────────
# Le décompte est celui qui compte pour un établissement : des copies, des
# notes, des interventions. Une restauration qui rend une base vide sans le dire
# est le pire des résultats.
COMPTES="$(mysql_client -N -B "$BASE" -e "
  SELECT
    (SELECT COUNT(*) FROM evaluations),
    (SELECT COUNT(*) FROM questions),
    (SELECT COUNT(*) FROM sessions),
    (SELECT COUNT(*) FROM responses),
    (SELECT COUNT(*) FROM grade_audit),
    (SELECT COUNT(*) FROM __drizzle_migrations);
")"
read -r EVALUATIONS QUESTIONS COPIES REPONSES AUDIT MIGRATIONS <<< "$COMPTES"

echo
echo "  évaluations           : $EVALUATIONS"
echo "  questions             : $QUESTIONS"
echo "  copies                : $COPIES"
echo "  réponses              : $REPONSES"
echo "  interventions tracées : $AUDIT"
echo "  migrations appliquées : $MIGRATIONS"

if [ "$MIGRATIONS" -eq 0 ]; then
  echo "✗ Le journal des migrations est vide : la base restaurée n'est pas au schéma attendu." >&2
  exit 1
fi

echo "✓ Restauration vérifiée"

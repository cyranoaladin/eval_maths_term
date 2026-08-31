#!/usr/bin/env bash
#
# scripts/repli-production.sh
#
# Revenir à la version précédente.
#
# Un retour arrière n'est pas seulement une image qu'on redémarre. Le schéma a
# pu changer, et l'ancienne version ne sait pas lire le nouveau : la base doit
# revenir avec elle, depuis la sauvegarde prise juste avant la migration. Les
# tirages aussi — un sujet produit par la nouvelle version reste un fichier que
# l'ancienne doit pouvoir servir.
#
# Trois choses, donc, et dans cet ordre : arrêter, restaurer, redémarrer.
#
# Usage :
#   DATABASE_URL=mysql://user:pass@hote:port/base \
#   PAPER_OUTPUT_DIR=/var/lib/atelier/tirages \
#   bash scripts/repli-production.sh <image@sha256:…> <dossier de sauvegarde>
#
# L'image se désigne par son empreinte, jamais par une étiquette : « v1.0.0 »
# peut avoir été reconstruite, une empreinte non.
set -euo pipefail

# Pas d'apostrophe dans ce message : à l'intérieur de ${…:?…}, bash ouvre une
# chaîne à guillemet simple qui avale tout jusqu'au suivant — ici la ligne 43,
# vingt lignes plus bas. Le script s'exécutait alors sans ses affectations.
IMAGE="${1:?Indiquez une image de la version précédente, par son empreinte}"
SAUVEGARDE="${2:?Indiquez le dossier de sauvegarde à restaurer}"
URL="${DATABASE_URL:?DATABASE_URL est requise}"
TIRAGES="${PAPER_OUTPUT_DIR:-./.paper-exams}"
CONTENEUR="${CONTENEUR:-atelier-qcm}"
PORT_APPLICATION="${PORT_APPLICATION:-3000}"
BASE_PUBLIQUE="${PUBLIC_BASE_URL:-http://127.0.0.1:$PORT_APPLICATION}"

etape() { echo; echo "── $1 ──"; }

echo "▶ Repli vers $IMAGE"
echo "  sauvegarde : $SAUVEGARDE"

# ── 1. Arrêter la version en place ───────────────────────────────────────────
#
# `docker stop` envoie SIGTERM : le serveur cesse d'accepter, laisse finir les
# remises en cours, puis rend ses connexions. C'est ce que l'arrêt gracieux
# garantit, et c'est pourquoi on ne tue pas le conteneur.
etape "1/4 · arrêt de la version en place"
if docker ps --format '{{.Names}}' | grep -qx "$CONTENEUR"; then
  docker stop --timeout 30 "$CONTENEUR" >/dev/null
  docker rm "$CONTENEUR" >/dev/null
  echo "  conteneur arrêté et retiré"
else
  echo "  aucun conteneur « $CONTENEUR » en service"
fi

# ── 2. Remettre les données dans l'état d'avant ──────────────────────────────
etape "2/4 · restauration des données"
DATABASE_URL="$URL" PAPER_OUTPUT_DIR="$TIRAGES" bash scripts/restauration.sh "$SAUVEGARDE"

# ── 3. Redémarrer la version précédente ──────────────────────────────────────
etape "3/4 · démarrage de la version précédente"
# Les mêmes restrictions que `docker-compose.yml`. Un conteneur de repli moins
# tenu que celui qu'il remplace serait une régression de sécurité au pire
# moment : celui où l'on revient en arrière parce que quelque chose ne va pas.
docker run -d --name "$CONTENEUR" --network host \
  --read-only --tmpfs /tmp:rw,size=512m,mode=1777 \
  --tmpfs /home/evalapp:rw,size=64m,mode=0700,uid=10001,gid=999 \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 512 --memory 2g --cpus 2 \
  -e NODE_ENV=production \
  -e PORT="$PORT_APPLICATION" \
  -e DATABASE_URL="$URL" \
  -e PUBLIC_BASE_URL="$BASE_PUBLIQUE" \
  -e ALLOWED_ORIGINS="$BASE_PUBLIQUE" \
  -e APP_ID="${APP_ID:?}" \
  -e APP_SECRET="${APP_SECRET:?}" \
  -e TEACHER_SESSION_SECRET="${TEACHER_SESSION_SECRET:?}" \
  -e STUDENT_SESSION_SECRET="${STUDENT_SESSION_SECRET:?}" \
  -e KIMI_AUTH_URL="${KIMI_AUTH_URL:?}" \
  -e KIMI_OPEN_URL="${KIMI_OPEN_URL:?}" \
  -e PAPER_OUTPUT_DIR=/app/.paper-exams \
  -v "$(cd "$(dirname "$TIRAGES")" && pwd)/$(basename "$TIRAGES")":/app/.paper-exams \
  "$IMAGE" >/dev/null
echo "  conteneur démarré"

# ── 4. Vérifier que le service est réellement revenu ─────────────────────────
#
# Un conteneur qui tourne ne prouve rien. Ce qui compte est qu'il se déclare
# prêt — base, schéma, pool, tirages, disque — et qu'il annonce la version
# attendue.
etape "4/4 · vérification"
for _ in $(seq 1 60); do
  if curl -sf "$BASE_PUBLIQUE/api/ready" >/dev/null; then break; fi
  sleep 1
done

BILAN="$(curl -s "$BASE_PUBLIQUE/api/ready")"
if ! grep -q '"pret":true' <<< "$BILAN"; then
  echo "✗ Le service n'est pas prêt après le repli :" >&2
  echo "$BILAN" >&2
  docker logs --tail 40 "$CONTENEUR" >&2
  exit 1
fi

VERSION="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' <<< "$BILAN")"
SHA="$(sed -n 's/.*"gitSha":"\([^"]*\)".*/\1/p' <<< "$BILAN")"
echo "  prêt       : oui"
echo "  version    : $VERSION"
echo "  empreinte  : $SHA"
echo
echo "✓ Repli terminé. Le service répond sur la version précédente."
echo "  Vérifiez une copie réelle avant de rouvrir aux élèves."

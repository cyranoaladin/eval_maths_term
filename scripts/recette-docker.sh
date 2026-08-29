#!/usr/bin/env bash
#
# scripts/recette-docker.sh
#
# Recette de mise en service, exécutée sur le runtime destiné à la production.
#
# Ce qui compte ici, ce n'est pas que l'application démarre sur la machine de
# développement — elle y démarre depuis des mois — mais qu'elle démarre dans
# l'image qui sera déployée, avec une base vierge, ses migrations, et une
# génération AMC réelle. Chaque étape échoue bruyamment.
#
#   bash scripts/recette-docker.sh
#
set -uo pipefail

PROJET="recette-eval-$$"
IMAGE_BASE="eval-maths:recette"
IMAGE_AMC="eval-maths-amc:recette"
RESEAU="${PROJET}-net"
BASE="${PROJET}-mysql"
APP="${PROJET}-app"
MDP_ROOT="recette_root_$$"
MDP_APP="recette_app_$$"

echecs=0
etape=0
ok() {
  etape=$((etape + 1))
  if [ "$2" = "0" ]; then
    printf '  ✓ %2d. %s%s\n' "$etape" "$1" "${3:+ — $3}"
  else
    printf '  ✗ %2d. %s%s\n' "$etape" "$1" "${3:+ — $3}"
    echecs=$((echecs + 1))
  fi
}

nettoyer() {
  docker rm -f "$APP" "$BASE" >/dev/null 2>&1 || true
  docker network rm "$RESEAU" >/dev/null 2>&1 || true
  docker volume rm "${PROJET}-data" >/dev/null 2>&1 || true
}
trap nettoyer EXIT

echo "▶ Recette Docker — runtime de production"
echo

# ── 1–2. Construction ────────────────────────────────────────────────────────
echo "Construction"
docker build -q -t "$IMAGE_BASE" . >/dev/null 2>&1
ok "l'image de base se construit" $? "$(docker image inspect "$IMAGE_BASE" --format '{{.Size}}' 2>/dev/null | awk '{printf "%.0f Mo", $1/1048576}')"

docker build -q -t "$IMAGE_AMC" -f Dockerfile.amc --build-arg IMAGE_BASE="$IMAGE_BASE" . >/dev/null 2>&1
ok "l'image avec impression se construit" $? "$(docker image inspect "$IMAGE_AMC" --format '{{.Size}}' 2>/dev/null | awk '{printf "%.0f Mo", $1/1048576}')"

# ── 3. Base vierge ───────────────────────────────────────────────────────────
echo
echo "Environnement propre"
docker network create "$RESEAU" >/dev/null 2>&1
docker run -d --name "$BASE" --network "$RESEAU" \
  -e MYSQL_ROOT_PASSWORD="$MDP_ROOT" \
  -e MYSQL_DATABASE=eval_maths \
  -e MYSQL_USER=eval -e MYSQL_PASSWORD="$MDP_APP" \
  -v "${PROJET}-data:/var/lib/mysql" \
  mysql:8.4 >/dev/null 2>&1
pret=1
for _ in $(seq 1 60); do
  if docker exec "$BASE" mysqladmin ping -h 127.0.0.1 -u root -p"$MDP_ROOT" >/dev/null 2>&1; then pret=0; break; fi
  sleep 2
done
ok "une base vierge démarre" "$pret"

DB_URL="mysql://eval:${MDP_APP}@${BASE}:3306/eval_maths"
SECRET_A="$(openssl rand -base64 48 | tr -d '\n=+/' | head -c 48)"
SECRET_B="$(openssl rand -base64 48 | tr -d '\n=+/' | head -c 48)"
SECRET_C="$(openssl rand -base64 48 | tr -d '\n=+/' | head -c 48)"

env_app() {
  printf -- "-e NODE_ENV=production -e PORT=3000 -e DATABASE_URL=%s -e APP_ID=recette -e APP_SECRET=%s -e TEACHER_SESSION_SECRET=%s -e STUDENT_SESSION_SECRET=%s -e KIMI_AUTH_URL=https://auth.invalid -e KIMI_OPEN_URL=https://open.invalid -e ALLOWED_ORIGINS=http://localhost:3100 -e PAPER_OUTPUT_DIR=/data/paper-exams" \
    "$DB_URL" "$SECRET_A" "$SECRET_B" "$SECRET_C"
}

# ── 4. Migrations sur base vierge ────────────────────────────────────────────
# Les migrations sont appliquées depuis l'image elle-même : c'est le seul
# chemin qui existe réellement en production. `drizzle-kit` est une dépendance
# de développement, absente de l'image.
docker run --rm --network "$RESEAU" $(env_app) "$IMAGE_BASE" node dist/migrate.js >/dev/null 2>&1
ok "les migrations passent sur une base vierge, depuis l'image" $?

tables=$(docker exec "$BASE" mysql -u root -p"$MDP_ROOT" -N -B -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='eval_maths'" 2>/dev/null)
ok "le schéma est créé" "$([ "${tables:-0}" -ge 10 ] && echo 0 || echo 1)" "${tables:-0} tables"

typeScore=$(docker exec "$BASE" mysql -u root -p"$MDP_ROOT" -N -B -e \
  "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='eval_maths' AND TABLE_NAME='responses' AND COLUMN_NAME='score'" 2>/dev/null)
ok "les scores sont décimaux dans l'image déployée" \
  "$([ "$typeScore" = "decimal(6,2)" ] && echo 0 || echo 1)" "$typeScore"

# ── 5. Refus des secrets de développement ────────────────────────────────────
echo
echo "Garde-fous de production"
sortie=$(docker run --rm --network "$RESEAU" \
  -e NODE_ENV=production -e DATABASE_URL="$DB_URL" -e APP_ID=recette \
  -e APP_SECRET="$SECRET_A" \
  -e TEACHER_SESSION_SECRET=dev_teacher_secret_change_in_production_at_least_32 \
  -e STUDENT_SESSION_SECRET="$SECRET_C" \
  -e KIMI_AUTH_URL=https://auth.invalid -e KIMI_OPEN_URL=https://open.invalid \
  -e ALLOWED_ORIGINS=http://localhost:3100 \
  "$IMAGE_BASE" node dist/boot.js 2>&1 | head -20)
echo "$sortie" | grep -q "Configuration de production refusée"
ok "le secret de développement est refusé en production" $? \
  "$(echo "$sortie" | grep -o 'TEACHER_SESSION_SECRET[^:]*' | head -1)"

# ── 6. Démarrage et santé ────────────────────────────────────────────────────
echo
echo "Démarrage"
depart=$(date +%s%N)
docker run -d --name "$APP" --network "$RESEAU" -p 127.0.0.1:3100:3000 \
  $(env_app) -v "${PROJET}-data-paper:/data/paper-exams" "$IMAGE_AMC" >/dev/null 2>&1
sain=1
for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:3100/api/health >/dev/null 2>&1; then sain=0; break; fi
  sleep 0.5
done
fin=$(date +%s%N)
ms=$(( (fin - depart) / 1000000 ))
ok "le conteneur répond au contrôle de santé" "$sain" "${ms} ms"
ok "le démarrage tient sous trente secondes" "$([ "$ms" -lt 30000 ] && echo 0 || echo 1)" "${ms} ms"

# ── 7. AMC dans le runtime ───────────────────────────────────────────────────
# On vérifie exactement ce que vérifie `isAmcAvailable()` — l'exécutable dans
# le PATH — puis le répartiteur Perl que la préparation appelle réellement.
# `auto-multiple-choice version` ouvrirait l'interface graphique.
docker exec "$APP" which auto-multiple-choice >/dev/null 2>&1 \
  && docker exec "$APP" test -f /usr/libexec/AMC/perl/AMC-prepare.pl
ok "auto-multiple-choice est utilisable dans le runtime" $? \
  "version $(docker exec "$APP" sh -c "dpkg-query -W -f='\${Version}' auto-multiple-choice" 2>/dev/null)"

latex=$(docker exec "$APP" sh -c "kpsewhich automultiplechoice.sty" 2>/dev/null)
ok "la classe LaTeX d'AMC est installée" \
  "$([ -n "$latex" ] && echo 0 || echo 1)" "${latex:-absente}"

# ── 8. Migration d'une base existante ────────────────────────────────────────
echo
echo "Montée de version"
docker exec "$BASE" mysql -u root -p"$MDP_ROOT" eval_maths -e \
  "INSERT INTO evaluations (id, title, duration, isActive) VALUES (900, 'Historique', 60, 1);
   INSERT INTO sessions (id, evaluationId, studentName, status) VALUES (900, 900, 'Élève historique', 'completed');
   INSERT INTO questions (id, evaluationId, type, question, correctAnswer, points, \`order\`) VALUES (900, 900, 'short_answer', 'Q', '2', 2, 1);
   INSERT INTO responses (id, sessionId, questionId, answer, score, maxScore) VALUES (900, 900, 900, 'x', 1.75, 2);" >/dev/null 2>&1
ok "des données existantes sont enregistrées" $?

docker run --rm --network "$RESEAU" $(env_app) "$IMAGE_BASE" node dist/migrate.js >/dev/null 2>&1
ok "rejouer les migrations sur une base peuplée est sans effet" $?

conserve=$(docker exec "$BASE" mysql -u root -p"$MDP_ROOT" -N -B eval_maths -e \
  "SELECT score FROM responses WHERE id = 900" 2>/dev/null)
ok "la note fractionnaire existante est intacte" \
  "$([ "$conserve" = "1.75" ] && echo 0 || echo 1)" "$conserve"

# ── 9. Surface servie ────────────────────────────────────────────────────────
echo
echo "Surface servie"
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/)
ok "l'application est servie" "$([ "$code" = "200" ] && echo 0 || echo 1)" "HTTP $code"

code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/mathlive/fonts/KaTeX_Main-Regular.woff2)
ok "les polices mathématiques sont servies" "$([ "$code" = "200" ] && echo 0 || echo 1)" "HTTP $code"

corps=$(curl -s "http://127.0.0.1:3100/api/trpc/evaluation.listPublic")
echo "$corps" | grep -q '"result"'
ok "l'API publique répond" $?

code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3100/api/trpc/session.getAllForTeacher")
ok "une route enseignant reste fermée sans authentification" \
  "$([ "$code" = "401" ] || [ "$code" = "403" ] && echo 0 || echo 1)" "HTTP $code"

echo
if [ "$echecs" -eq 0 ]; then
  echo "✅ Recette Docker : $etape étapes vérifiées sur le runtime de production."
else
  echo "❌ $echecs étape(s) en échec sur $etape."
fi
exit "$echecs"

#!/usr/bin/env bash
#
# .github/perf/environnement.sh
#
# Monte et démonte l'environnement de mesure : MySQL épinglée, l'image
# candidate migrée et semée, le serveur prêt. Tout est nommé `perf-*` et
# meurt avec `demonter` — rien ne survit à une mesure.
#
# Fonctions : monter <image>, demonter, verifier_proprete
set -uo pipefail

IMAGE_MYSQL="${IMAGE_MYSQL:?}"
PORT_APPLICATION="${PORT_APPLICATION:-3000}"
BASE_URL="http://127.0.0.1:${PORT_APPLICATION}"

monter() {
  local image="$1"

  # Identifiants éphémères : tirés ici, morts avec l'environnement.
  MDP_ROOT="$(openssl rand -hex 16)"
  MDP_APP="$(openssl rand -hex 16)"
  export DATABASE_URL="mysql://perf:${MDP_APP}@127.0.0.1:3306/eval_maths"

  docker network create perf-net >/dev/null 2>&1 || true

  docker run -d --name perf-mysql --network host \
    -e MYSQL_ROOT_PASSWORD="$MDP_ROOT" \
    -e MYSQL_DATABASE=eval_maths \
    -e MYSQL_USER=perf \
    -e MYSQL_PASSWORD="$MDP_APP" \
    "$IMAGE_MYSQL" >/dev/null

  echo "  attente de MySQL…"
  for _ in $(seq 1 120); do
    docker exec perf-mysql mysqladmin ping -h 127.0.0.1 -uperf -p"$MDP_APP" --silent >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec perf-mysql mysqladmin ping -h 127.0.0.1 -uperf -p"$MDP_APP" --silent >/dev/null 2>&1 \
    || { echo "✗ MySQL ne répond pas" >&2; return 1; }

  # Les secrets de service : éphémères eux aussi. Le binaire de l'image lit
  # l'environnement complet dès son chargement : ils précèdent les migrations.
  APP_SECRET_PERF="$(openssl rand -hex 32)"
  SECRET_ENS="$(openssl rand -hex 32)"
  SECRET_ELEVE="$(openssl rand -hex 32)"

  echo "  migrations et jeu de données, par les binaires de l'image candidate…"
  for binaire in dist/migrate.js dist/seed.js; do
    docker run --rm --network host \
      -e DATABASE_URL="$DATABASE_URL" \
      -e PUBLIC_BASE_URL="$BASE_URL" -e ALLOWED_ORIGINS="$BASE_URL" \
      -e APP_ID=perf-app-id -e APP_SECRET="$APP_SECRET_PERF" \
      -e TEACHER_SESSION_SECRET="$SECRET_ENS" -e STUDENT_SESSION_SECRET="$SECRET_ELEVE" \
      -e KIMI_AUTH_URL=https://auth.perf.invalid -e KIMI_OPEN_URL=https://open.perf.invalid \
      --entrypoint node "$image" "$binaire" >/dev/null
  done

  # Les mêmes restrictions que le compose de production.
  docker run -d --name perf-app --network host \
    --read-only --tmpfs /tmp:rw,size=512m,mode=1777 \
    --tmpfs /home/evalapp:rw,size=64m,mode=0700,uid=10001,gid=10001 \
    --tmpfs /data/paper-exams:rw,size=256m,mode=0755,uid=10001,gid=10001 \
    --cap-drop ALL --security-opt no-new-privileges \
    --pids-limit 512 --memory 2g --cpus 2 \
    -e NODE_ENV=production \
    -e PORT="$PORT_APPLICATION" \
    -e DATABASE_URL="$DATABASE_URL" \
    -e PUBLIC_BASE_URL="$BASE_URL" \
    -e ALLOWED_ORIGINS="$BASE_URL" \
    -e APP_ID=perf-app-id \
    -e APP_SECRET="$APP_SECRET_PERF" \
    -e TEACHER_SESSION_SECRET="$SECRET_ENS" \
    -e STUDENT_SESSION_SECRET="$SECRET_ELEVE" \
    -e KIMI_AUTH_URL=https://auth.perf.invalid \
    -e KIMI_OPEN_URL=https://open.perf.invalid \
    "$image" >/dev/null

  echo "  attente de la disponibilité…"
  for _ in $(seq 1 60); do
    curl -sf "$BASE_URL/api/ready" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -sf "$BASE_URL/api/ready" | grep -q '"pret":true' \
    || { echo "✗ le service n'est pas prêt" >&2; docker logs --tail 30 perf-app >&2; return 1; }
  echo "  service prêt sur $BASE_URL"
}

demonter() {
  docker rm -f perf-app perf-mysql >/dev/null 2>&1 || true
  docker network rm perf-net >/dev/null 2>&1 || true
}

verifier_proprete() {
  local reste=0
  if docker ps -a --format '{{.Names}}' | grep -q '^perf-'; then
    echo "✗ conteneurs résiduels :"; docker ps -a | grep 'perf-'; reste=1
  fi
  if docker volume ls --format '{{.Name}}' | grep -q '^perf-'; then
    echo "✗ volumes résiduels :"; docker volume ls | grep 'perf-'; reste=1
  fi
  if ss -tln | awk '{print $4}' | grep -qE ":(3000|3306)$"; then
    echo "✗ un port de mesure est resté ouvert :"; ss -tln; reste=1
  fi
  [ "$reste" -eq 0 ] && echo "  aucun résidu : conteneurs, volumes, ports propres"
  return "$reste"
}

releves_mysql() {
  docker exec perf-mysql mysql -uperf -p"$MDP_APP" -N -B \
    -e "SHOW STATUS LIKE 'Threads_connected';" 2>/dev/null | awk '{print $2}'
}

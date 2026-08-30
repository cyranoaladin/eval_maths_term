#!/usr/bin/env bash
#
# .github/base-ephemere.sh
#
# Démarre une base MySQL pour un job de CI, avec un mot de passe tiré au hasard.
#
# Le bloc `services:` de GitHub Actions exige des identifiants littéraux dans le
# fichier de workflow — c'est-à-dire versionnés. Ceux-ci meurent avec le runner
# et ne sont écrits nulle part.
set -euo pipefail

BASE="${1:?nom de la base}"
MDP="$(openssl rand -hex 24)"
echo "::add-mask::$MDP"

docker run -d --name mysql-ci \
  -e MYSQL_ROOT_PASSWORD="$MDP" \
  -e MYSQL_DATABASE="$BASE" \
  -p 127.0.0.1:3306:3306 \
  mysql:8.4 >/dev/null

for _ in $(seq 1 60); do
  if docker exec mysql-ci mysqladmin ping -h 127.0.0.1 -u root -p"$MDP" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker exec mysql-ci mysqladmin ping -h 127.0.0.1 -u root -p"$MDP" >/dev/null

URL="mysql://root:${MDP}@127.0.0.1:3306/${BASE}"
{
  echo "DATABASE_URL=$URL"
  echo "TEST_DATABASE_URL=mysql://root:${MDP}@127.0.0.1:3306/eval_maths_test"
} >> "$GITHUB_ENV"

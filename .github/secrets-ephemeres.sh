#!/usr/bin/env bash
#
# .github/secrets-ephemeres.sh
#
# `api/lib/env.ts` valide la configuration au chargement : sans elle, tests et
# build échouent avant de commencer. Les secrets sont tirés au hasard à chaque
# exécution — une valeur fixe dans un fichier de CI est une valeur publique,
# même si elle ne sert qu'aux tests.
set -euo pipefail

for nom in APP_SECRET TEACHER_SESSION_SECRET STUDENT_SESSION_SECRET; do
  valeur="$(openssl rand -hex 32)"
  echo "::add-mask::$valeur"
  echo "$nom=$valeur" >> "$GITHUB_ENV"
done

{
  echo "APP_ID=ci"
  echo "KIMI_AUTH_URL=http://localhost:9999"
  echo "KIMI_OPEN_URL=http://localhost:9998"
  echo "ALLOWED_ORIGINS=http://localhost:3000"
  echo "LOG_LEVEL=error"
} >> "$GITHUB_ENV"

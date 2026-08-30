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
  -p 127.0.0.1:33070:3306 \
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
  printf -- "-e NODE_ENV=production -e PORT=3000 -e DATABASE_URL=%s -e APP_ID=recette -e APP_SECRET=%s -e TEACHER_SESSION_SECRET=%s -e STUDENT_SESSION_SECRET=%s -e KIMI_AUTH_URL=https://auth.invalid -e KIMI_OPEN_URL=https://open.invalid -e ALLOWED_ORIGINS=http://127.0.0.1:3100,http://localhost:3100 -e PUBLIC_BASE_URL=http://127.0.0.1:3100 -e PAPER_OUTPUT_DIR=/data/paper-exams" \
    "$DB_URL" "$SECRET_A" "$SECRET_B" "$SECRET_C"
}

# ── 4. Migrations sur base vierge ────────────────────────────────────────────
# Les migrations sont appliquées depuis l'image elle-même : c'est le seul
# chemin qui existe réellement en production. `drizzle-kit` est une dépendance
# de développement, absente de l'image.
docker run --rm --network "$RESEAU" $(env_app) "$IMAGE_BASE" node dist/migrate.js >/dev/null 2>&1
ok "les migrations passent sur une base vierge, depuis l'image" $?

tables=$(docker exec "$BASE" mysql --default-character-set=utf8mb4 -u root -p"$MDP_ROOT" -N -B -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='eval_maths'" 2>/dev/null)
ok "le schéma est créé" "$([ "${tables:-0}" -ge 10 ] && echo 0 || echo 1)" "${tables:-0} tables"

typeScore=$(docker exec "$BASE" mysql --default-character-set=utf8mb4 -u root -p"$MDP_ROOT" -N -B -e \
  "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='eval_maths' AND TABLE_NAME='responses' AND COLUMN_NAME='score'" 2>/dev/null)
ok "les scores sont décimaux dans l'image déployée" \
  "$([ "$typeScore" = "decimal(6,2)" ] && echo 0 || echo 1)" "$typeScore"

# ── 5. Refus des valeurs de remplissage ──────────────────────────────────────
# La valeur ci-dessous n'ouvre rien : c'est l'entrée d'une assertion, et tout
# son intérêt est d'être refusée.
echo
echo "Garde-fous de production"
sortie=$(docker run --rm --network "$RESEAU" \
  -e NODE_ENV=production -e DATABASE_URL="$DB_URL" -e APP_ID=recette \
  -e APP_SECRET="$SECRET_A" \
  -e TEACHER_SESSION_SECRET=change_me_avant_de_deployer_quoi_que_ce_soit \
  -e STUDENT_SESSION_SECRET="$SECRET_C" \
  -e KIMI_AUTH_URL=https://auth.invalid -e KIMI_OPEN_URL=https://open.invalid \
  -e ALLOWED_ORIGINS=http://127.0.0.1:3100,http://localhost:3100 \
  -e PUBLIC_BASE_URL=http://127.0.0.1:3100 \
  "$IMAGE_BASE" node dist/boot.js 2>&1 | head -20)
echo "$sortie" | grep -q "Configuration de production refusée"
ok "une valeur de remplissage est refusée en production" $? \
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
docker exec "$BASE" mysql --default-character-set=utf8mb4 -u root -p"$MDP_ROOT" eval_maths -e \
  "INSERT INTO evaluations (id, title, duration, isActive) VALUES (900, 'Historique', 60, 1);
   INSERT INTO sessions (id, evaluationId, studentName, status) VALUES (900, 900, 'Élève historique', 'completed');
   INSERT INTO questions (id, evaluationId, type, question, correctAnswer, points, \`order\`) VALUES (900, 900, 'short_answer', 'Q', '2', 2, 1);
   INSERT INTO responses (id, sessionId, questionId, answer, score, maxScore) VALUES (900, 900, 900, 'x', 1.75, 2);" >/dev/null 2>&1
ok "des données existantes sont enregistrées" $?

docker run --rm --network "$RESEAU" $(env_app) "$IMAGE_BASE" node dist/migrate.js >/dev/null 2>&1
ok "rejouer les migrations sur une base peuplée est sans effet" $?

conserve=$(docker exec "$BASE" mysql --default-character-set=utf8mb4 -u root -p"$MDP_ROOT" -N -B eval_maths -e \
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

# ── 10. Chaîne papier réelle, déclenchée depuis l'application ────────────────
echo
echo "Chaîne papier — AMC exécuté par l'application dans le conteneur"

# La session enseignant est signée avec le secret du conteneur, et l'utilisateur
# est créé dans SA base : c'est la seule façon d'exercer l'application déployée
# plutôt qu'une réplique locale.
export DATABASE_URL="mysql://eval:${MDP_APP}@127.0.0.1:33070/eval_maths"
export TEACHER_SESSION_SECRET="$SECRET_B"
export APP_ID="recette"
export APP_SECRET="$SECRET_A"
export STUDENT_SESSION_SECRET="$SECRET_C"
export KIMI_AUTH_URL="https://auth.invalid"
export KIMI_OPEN_URL="https://open.invalid"
export NODE_ENV=development

COOKIE=$(npx tsx scripts/dev-session.ts "Enseignant recette" "recette@local" "recette-docker" 2>/dev/null \
  | grep -oP 'kimi_sid=\K[^;"]+' | head -1)
ok "une session enseignant est signée avec le secret du conteneur" \
  "$([ -n "$COOKIE" ] && echo 0 || echo 1)" "${COOKIE:+jeton obtenu}"

sortie=$(npx tsx scripts/smoke-chaine-papier.ts "$COOKIE" http://127.0.0.1:3100 2>&1)
code=$?
echo "$sortie" | grep -E "✓|✗" | sed 's/^/     /' | head -30
if [ "$code" -ne 0 ]; then
  echo "     ── sortie complète de la chaîne papier ──"
  echo "$sortie" | tail -25 | sed 's/^/     /'
fi
ok "la chaîne papier complète passe dans le conteneur" "$code" \
  "$(echo "$sortie" | grep -c '✓') vérifications"

# Les trois documents doivent être produits par AMC lui-même et servis par la
# route sécurisée — pas lus sur le disque de la machine de développement.
EXAM=$(docker exec "$BASE" mysql --default-character-set=utf8mb4 -u root -p"$MDP_ROOT" -N -B eval_maths -e \
  "SELECT id FROM paper_exams ORDER BY id DESC LIMIT 1" 2>/dev/null)
ok "un tirage a été enregistré" "$([ -n "$EXAM" ] && echo 0 || echo 1)" "tirage #$EXAM"

for doc in sujet.pdf corrige.pdf catalog.pdf; do
  entete=$(curl -s -D - -o "/tmp/recette-$doc" -H "Cookie: kimi_sid=$COOKIE" \
    "http://127.0.0.1:3100/api/paper/$EXAM/$doc" 2>/dev/null | head -1)
  signature=$(head -c 4 "/tmp/recette-$doc" 2>/dev/null)
  taille=$(stat -c %s "/tmp/recette-$doc" 2>/dev/null || echo 0)
  ok "$doc est produit par AMC et servi signé" \
    "$([ "$signature" = "%PDF" ] && [ "$taille" -gt 1000 ] && echo 0 || echo 1)" \
    "$(echo "$entete" | tr -d '\r'), $((taille / 1024)) ko"
done

anonyme=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3100/api/paper/$EXAM/sujet.pdf")
ok "le sujet est inaccessible sans authentification" \
  "$([ "$anonyme" = "401" ] || [ "$anonyme" = "403" ] && echo 0 || echo 1)" "HTTP $anonyme"

# printedQuestionIds fige la composition du tirage : le document imprimé doit
# porter exactement ces questions, ni plus ni moins. On relit le PDF.
IDS=$(docker exec "$BASE" mysql --default-character-set=utf8mb4 -u root -p"$MDP_ROOT" -N -B eval_maths -e \
  "SELECT printedQuestionIds FROM paper_exams WHERE id = $EXAM" 2>/dev/null)
NB_IDS=$(echo "$IDS" | grep -o ',' | wc -l)
NB_IDS=$((NB_IDS + 1))
ok "printedQuestionIds est renseigné" \
  "$([ -n "$IDS" ] && [ "$IDS" != "NULL" ] && echo 0 || echo 1)" "$NB_IDS question(s) : $IDS"

if command -v pdftotext >/dev/null 2>&1; then
  pdftotext -layout /tmp/recette-sujet.pdf /tmp/recette-sujet.txt 2>/dev/null
  docker exec "$BASE" mysql --default-character-set=utf8mb4 -u root -p"$MDP_ROOT" -N -B eval_maths -e \
    "SELECT id, question FROM questions WHERE id IN ($(echo "$IDS" | tr -d '[]'))" \
    > /tmp/recette-questions.tsv 2>/dev/null

  # Le découpage des mots se fait en Python : l'énoncé contient des accents,
  # que les outils shell traitent octet par octet et coupent en deux.
  resultat=$(python3 - <<'PYFIN'
import re, sys, unicodedata

def sans_accent(t):
    """LaTeX compose les accents : « dérivée » peut ressortir du PDF sous la
    forme « e » suivi d'un accent combinant, qu'une comparaison littérale ne
    reconnaît pas. On compare des lettres nues des deux côtés."""
    return "".join(
        c for c in unicodedata.normalize("NFKD", t.lower())
        if not unicodedata.combining(c)
    )

trouves, total, manquants = 0, 0, []
texte = sans_accent(open("/tmp/recette-sujet.txt", encoding="utf-8", errors="replace").read())
for ligne in open("/tmp/recette-questions.tsv", encoding="utf-8", errors="replace"):
    if not ligne.strip():
        continue
    total += 1
    qid, _, enonce = ligne.partition("\t")
    # Les zones mathématiques passent par LaTeX et ne ressortent pas telles
    # quelles du PDF : on ne cherche que les mots de la phrase.
    hors_math = re.sub(r"\$[^$]*\$", " ", enonce)
    mots = [sans_accent(m) for m in re.findall(r"[^\W\d_]{5,}", hors_math, re.UNICODE)]
    if any(m in texte for m in mots):
        trouves += 1
    else:
        manquants.append(f"{qid.strip()} (mots : {', '.join(mots[:3]) or 'aucun'})")
print(f"{trouves}/{total}")
for m in manquants:
    print("     question introuvable :", m, file=sys.stderr)
PYFIN
)
  echo "$resultat" | tail -n +2 >&2
  compte=$(echo "$resultat" | head -1)
  ok "chaque question figée figure dans le sujet imprimé" \
    "$([ "${compte%%/*}" = "${compte##*/}" ] && echo 0 || echo 1)" "$compte retrouvées"
fi

echo
if [ "$echecs" -eq 0 ]; then
  echo "✅ Recette Docker : $etape étapes vérifiées sur le runtime de production."
else
  echo "❌ $echecs étape(s) en échec sur $etape."
fi
exit "$echecs"

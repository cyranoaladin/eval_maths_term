#!/usr/bin/env bash
#
# .github/perf/endurance-propre.sh <image> [durée]
#
# P32 : l'endurance, sur environnement propre.
#
# Trente minutes de trafic synthétique cohérent — le scénario d'endurance du
# dépôt : une copie ouverte, composée et remise chaque seconde — pendant que
# l'on relève, toutes les trente secondes, ce qui pourrait dériver : mémoire
# du serveur, processeur, connexions MySQL, pic de la file du pool,
# croissance du système de fichiers.
#
# À la fin : les seuils k6 (0 erreur), les dérives lues sur les relevés, et un
# environnement rendu vide — aucun conteneur, aucun volume, aucun port.
set -euo pipefail

IMAGE="${1:?image requise}"
DUREE="${2:-30m}"
ICI="$(cd "$(dirname "$0")" && pwd)"
RESULTATS="perf-resultats"
mkdir -p "$RESULTATS"
RELEVE="$RESULTATS/endurance-releve.csv"

# shellcheck source=environnement.sh
source "$ICI/environnement.sh"

demonter
monter "$IMAGE"

memoire_app_ko() {
  docker exec perf-app sh -c 'awk "/VmRSS/ {print \$2}" /proc/1/status' 2>/dev/null || echo 0
}
pic_file_pool() {
  curl -s "$BASE_URL/api/health" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('filePool',{}).get('pic',0))" 2>/dev/null || echo 0
}
disque_donnees_ko() {
  docker exec perf-app du -sk /data/paper-exams 2>/dev/null | awk '{print $1}' || echo 0
}

echo "instant,rss_ko,cpu_pct,connexions_mysql,pic_file_pool,tirages_ko" > "$RELEVE"
echantillonner() {
  while true; do
    cpu=$(docker stats --no-stream --format '{{.CPUPerc}}' perf-app 2>/dev/null | tr -d '%')
    echo "$(date -u +%H:%M:%S),$(memoire_app_ko),${cpu:-0},$(releves_mysql),$(pic_file_pool),$(disque_donnees_ko)" >> "$RELEVE"
    sleep 30
  done
}

MEM_DEBUT=$(memoire_app_ko)
CONNEXIONS_DEBUT=$(releves_mysql)
echantillonner &
ECHANTILLONNEUR=$!
trap 'kill $ECHANTILLONNEUR 2>/dev/null || true; demonter' EXIT

echo "▶ Endurance $DUREE — mémoire de départ : ${MEM_DEBUT} ko, connexions : ${CONNEXIONS_DEBUT}"
CODE_K6=0
docker run --rm -i --network host --user "$(id -u):$(id -g)" \
  -e BASE_URL="$BASE_URL" -e DUREE="$DUREE" \
  -v "$PWD/$RESULTATS":/resultats \
  "$IMAGE_K6" run --quiet --summary-export /resultats/endurance.json - \
  < load/endurance.k6.js 2>&1 | tail -20 || CODE_K6=$?

kill $ECHANTILLONNEUR 2>/dev/null || true
MEM_FIN=$(memoire_app_ko)
CONNEXIONS_FIN=$(releves_mysql)
PIC_FILE=$(pic_file_pool)

BILAN=0
python3 - "$RESULTATS/endurance.json" "$RELEVE" "$MEM_DEBUT" "$MEM_FIN" "$CONNEXIONS_DEBUT" "$CONNEXIONS_FIN" "$PIC_FILE" <<'PY' || BILAN=$?
import csv, json, sys
d = json.load(open(sys.argv[1])); m = d["metrics"]
releves = list(csv.DictReader(open(sys.argv[2])))
mem_debut, mem_fin = int(sys.argv[3]), int(sys.argv[4])
mem_pic = max((int(r["rss_ko"]) for r in releves), default=mem_fin)
tirages = [int(r["tirages_ko"]) for r in releves if r["tirages_ko"].isdigit()]
print(f"  copies remises        : {int(m.get('remises',{}).get('count',0))}")
print(f"  erreurs HTTP          : {m['http_req_failed']['value']*100:.4f} %")
print(f"  échecs métier         : {m.get('echec_metier',{}).get('value',0)*100:.4f} %")
print(f"  mémoire (ko)          : départ {mem_debut}, pic {mem_pic}, fin {mem_fin}")
print(f"  connexions MySQL      : départ {sys.argv[5]}, fin {sys.argv[6]}")
print(f"  pic de file du pool   : {sys.argv[7]}")
print(f"  système de fichiers   : {tirages[0] if tirages else 0} → {tirages[-1] if tirages else 0} ko")
ok = m["http_req_failed"]["value"] == 0 and m.get("echec_metier",{}).get("value",0) == 0
# La dérive mémoire : la fin ne doit pas dépasser le pic de mi-parcours de
# façon monotone — on refuse une pente strictement croissante sur la dernière
# moitié des relevés.
moitie = [int(r["rss_ko"]) for r in releves][len(releves)//2:]
if len(moitie) >= 4 and all(b > a for a, b in zip(moitie, moitie[1:])):
    print("  ✗ la mémoire croît strictement sur toute la seconde moitié")
    ok = False
sys.exit(0 if ok else 1)
PY

trap - EXIT
demonter
verifier_proprete

if [ "$CODE_K6" -ne 0 ] || [ "$BILAN" -ne 0 ]; then
  echo "P32_ENDURANCE = FAIL (k6=$CODE_K6, bilan=$BILAN)" >&2
  exit 1
fi
echo
echo "P32_ENDURANCE = PASS ($DUREE)"

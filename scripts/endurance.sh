#!/usr/bin/env bash
#
# scripts/endurance.sh
#
# Test d'endurance : la charge tourne, et l'on regarde la pente.
#
# Une fuite de mémoire ou un pool qui ne rend pas ses connexions ne se voient
# pas en cinq minutes. Ce script tient un régime constant pendant une durée
# donnée et relève, toutes les trente secondes, ce qui dérive : mémoire
# résidente du serveur, connexions ouvertes vers la base, descripteurs de
# fichiers.
#
#   PID_SERVEUR=12345 DUREE=30m bash scripts/endurance.sh [fichier de relevé]
set -uo pipefail

BASE="${BASE_URL:-http://localhost:3000}"
DUREE="${DUREE:-30m}"
CADENCE="${CADENCE:-1}"
PID="${PID_SERVEUR:?Indiquez le PID du serveur à observer}"
RELEVE="${1:-endurance-releve.csv}"

echo "▶ Endurance — $BASE, $DUREE à ${CADENCE}/s, serveur $PID"

echo "instant,rss_ko,connexions_base,descripteurs" > "$RELEVE"

echelonner() {
  while kill -0 "$PID" 2>/dev/null; do
    rss=$(awk '/VmRSS/ {print $2}' "/proc/$PID/status" 2>/dev/null || echo 0)
    fd=$(ls "/proc/$PID/fd" 2>/dev/null | wc -l)
    # Les connexions de CE serveur, pas celles de tout ce qui tourne sur la
    # machine : plusieurs projets peuvent parler à la même base.
    cx=$(ss -tnp state established 2>/dev/null | grep -c "pid=$PID," || true)
    echo "$(date -u +%H:%M:%S),$rss,${cx:-0},$fd" >> "$RELEVE"
    sleep 30
  done
}
echelonner &
ECHANTILLONNEUR=$!
trap 'kill $ECHANTILLONNEUR 2>/dev/null' EXIT

docker run --rm -i --network host \
  -e BASE_URL="$BASE" -e DUREE="$DUREE" -e CADENCE="$CADENCE" \
  grafana/k6 run - < load/endurance.k6.js 2>&1 \
  | grep -E "http_req_duration\.\.|http_req_failed\.\.|echec_metier\.|refus_quota_429\.|remises\.|remise\.\.|iterations\.\." \
  | sed 's/^ *//'

kill $ECHANTILLONNEUR 2>/dev/null

echo
echo "── dérive observée ──"
python3 - "$RELEVE" <<'PY'
import csv, sys
lignes = list(csv.DictReader(open(sys.argv[1])))
if len(lignes) < 4:
    print("  relevé trop court pour conclure"); raise SystemExit(0)
def col(nom): return [int(l[nom]) for l in lignes if l[nom].isdigit()]
rss, cx, fd = col("rss_ko"), col("connexions_base"), col("descripteurs")
debut, fin = rss[:3], rss[-3:]
moy = lambda v: sum(v) / len(v)
delta = moy(fin) - moy(debut)
print(f"  relevés            : {len(lignes)} sur {len(lignes)//2} minutes")
print(f"  mémoire résidente  : {moy(debut)/1024:.0f} Mo → {moy(fin)/1024:.0f} Mo  ({delta/1024:+.0f} Mo)")
print(f"  maximum            : {max(rss)/1024:.0f} Mo")
print(f"  connexions base    : {min(cx)} → {max(cx)} (max {max(cx)})")
print(f"  descripteurs       : {min(fd)} → {fd[-1]} (max {max(fd)})")
pente = delta / max(1, (len(lignes) / 2))
print(f"  pente mémoire      : {pente/1024:+.2f} Mo/minute")
PY

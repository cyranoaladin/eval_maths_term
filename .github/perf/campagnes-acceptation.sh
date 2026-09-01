#!/usr/bin/env bash
#
# .github/perf/campagnes-acceptation.sh <image> [campagnes]
#
# P31 : les campagnes d'acceptation, sur environnement propre.
#
# Chaque campagne part d'un environnement NEUF — MySQL recréée, service
# redémarré — puis joue deux cents élèves concurrents. Les seuils vivent dans
# le scénario k6 lui-même : p95 < 500 ms, 0 erreur HTTP, 0 échec métier,
# 0 refus de quota. k6 sort en erreur si l'un d'eux casse.
#
# Recréer l'environnement entre les campagnes n'est pas du zèle : c'est ce qui
# rend les trois mesures indépendantes, et ce qui évite de se heurter au
# rate limit d'ouverture de session sans jamais le contourner.
set -euo pipefail

IMAGE="${1:?image requise}"
CAMPAGNES="${2:-3}"
ICI="$(cd "$(dirname "$0")" && pwd)"
RESULTATS="perf-resultats"
mkdir -p "$RESULTATS"

# shellcheck source=environnement.sh
source "$ICI/environnement.sh"

for n in $(seq 1 "$CAMPAGNES"); do
  echo
  echo "══ Campagne $n / $CAMPAGNES ══"
  demonter
  monter "$IMAGE"

  # Préchauffage court : caches du serveur et de la base, hors mesure.
  echo "  préchauffage…"
  docker run --rm -i --network host \
    -e BASE_URL="$BASE_URL" -e VUS=20 -e COMPOSITION_S=4 -e ETALEMENT_S=3 \
    "$IMAGE_K6" run --quiet - < load/acceptance-200.k6.js >/dev/null 2>&1 || true

  echo "  mesure : 200 concurrents…"
  debut=$(date +%s)
  CODE_K6=0
  docker run --rm -i --network host \
    -e BASE_URL="$BASE_URL" \
    -v "$PWD/$RESULTATS":/resultats \
    "$IMAGE_K6" run --summary-export "/resultats/campagne-$n.json" - \
    < load/acceptance-200.k6.js 2>&1 | tail -25 || CODE_K6=$?
  duree=$(( $(date +%s) - debut ))

  # Relevés d'environnement au sortir de la mesure.
  echo "  connexions MySQL : $(releves_mysql)"
  docker stats --no-stream --format '  {{.Name}} : CPU {{.CPUPerc}}, RAM {{.MemUsage}}' perf-app perf-mysql || true
  curl -s "$BASE_URL/api/health" | python3 -c "import json,sys; d=json.load(sys.stdin); print('  file du pool :', d.get('filePool'))" || true

  VERDICT=0
  python3 - "$RESULTATS/campagne-$n.json" <<'PY' || VERDICT=$?
import json, sys
d = json.load(open(sys.argv[1]))
m = d["metrics"]
duree = m["http_req_duration"]
print(f"  p50 = {duree['med']:.1f} ms ; p95 = {duree['p(95)']:.1f} ms ; p99 = {duree['p(99)']:.1f} ms")
print(f"  requêtes = {int(m['http_reqs']['count'])} ({m['http_reqs']['rate']:.1f}/s)")
print(f"  remises = {int(m.get('remises',{}).get('count',0))} ; échecs HTTP = {m['http_req_failed']['value']*100:.4f} % ; échecs métier = {m.get('echec_metier',{}).get('value',0)*100:.4f} %")
ok = duree["p(95)"] < 500 and m["http_req_failed"]["value"] == 0 and m.get("echec_metier",{}).get("value",0) == 0
sys.exit(0 if ok else 1)
PY

  if [ "$CODE_K6" -ne 0 ] || [ "$VERDICT" -ne 0 ]; then
    echo "✗ Campagne $n : seuils non tenus (k6=$CODE_K6, verdict=$VERDICT)" >&2
    demonter
    exit 1
  fi
  echo "✓ Campagne $n conforme (${duree}s)"
done

demonter
verifier_proprete
echo
echo "P31_ACCEPTATION = PASS ($CAMPAGNES campagnes)"

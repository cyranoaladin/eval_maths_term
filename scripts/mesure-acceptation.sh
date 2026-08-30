#!/usr/bin/env bash
#
# scripts/mesure-acceptation.sh
#
# Mesure officielle du critère 20, dans les conditions que la méthode impose :
# build de production, base migrée, préchauffage, puis trois exécutions
# consécutives espacées.
#
# L'espacement n'est pas cosmétique : `session.start` est plafonné à six cents
# ouvertures par tranche de cinq minutes et par adresse. Trois exécutions de
# deux cents élèves lancées à la suite épuiseraient ce quota et mesureraient le
# limiteur au lieu de l'application. Le quota de production n'est pas touché ;
# c'est le générateur de charge qui attend.
#
#   bash scripts/mesure-acceptation.sh [nombre d'exécutions]
#
set -uo pipefail

BASE="${BASE_URL:-http://localhost:3000}"
EXECUTIONS="${1:-3}"
SCENARIO="${SCENARIO:-load/acceptance-200.k6.js}"
ATTENTE_QUOTA="${ATTENTE_QUOTA:-330}"

resume() {
  grep -E "http_req_duration\.\.|http_req_failed\.\.|echec_metier\.|refus_quota_429\.|remises\.|sessions_ouvertes\.|remise\.\." \
    | sed 's/^ *//'
}

echo "▶ Mesure d'acceptation — $BASE"
echo "  scénario : $SCENARIO"
echo

echo "── préchauffage ──"
docker run --rm -i --network host -e BASE_URL="$BASE" -e VUS=20 -e COMPOSITION_S=4 -e ETALEMENT_S=3 \
  grafana/k6 run - < "$SCENARIO" 2>&1 | grep -E "echec_metier\." | sed 's/^ *//'

for n in $(seq 1 "$EXECUTIONS"); do
  echo
  echo "── attente de la fenêtre de quota (${ATTENTE_QUOTA} s) ──"
  sleep "$ATTENTE_QUOTA"
  echo "── exécution $n / $EXECUTIONS ──"
  docker run --rm -i --network host -e BASE_URL="$BASE" \
    grafana/k6 run - < "$SCENARIO" 2>&1 | resume
done

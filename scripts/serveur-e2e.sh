#!/usr/bin/env bash
#
# scripts/serveur-e2e.sh
#
# Cycle de vie explicite du serveur qui sert les parcours navigateur.
#
# Le serveur était lancé en tâche de fond et laissé au nettoyage final du
# runner, qui affichait « Terminate orphan process » à chaque exécution. Sur le
# poste de développement, la même habitude a laissé un serveur périmé occuper
# son port pendant quatre heures et demie : une campagne de mesure entière a
# tourné contre lui sans que personne s'en aperçoive.
#
#   bash scripts/serveur-e2e.sh demarrer   → vérifie, démarre, attend, contrôle
#   bash scripts/serveur-e2e.sh arreter    → SIGTERM, attend la sortie, vérifie
#   bash scripts/serveur-e2e.sh verifier   → aucun résidu du projet
#
# Variables : PORT_E2E, DATABASE_URL, APP_VERSION_ATTENDUE, GIT_SHA_ATTENDU.
set -uo pipefail

PORT="${PORT_E2E:-3200}"
BASE="http://127.0.0.1:$PORT"
FICHIER_PID="${FICHIER_PID:-.e2e-serveur.pid}"
JOURNAL="${JOURNAL_E2E:-serveur.log}"

echec() { echo "✗ $1" >&2; exit 1; }

port_occupe() { ss -ltn 2>/dev/null | grep -qE "[:.]$PORT\b"; }

processus_du_projet() {
  # Les `node dist/boot.js` dont le répertoire courant est ce dépôt, et eux
  # seuls : un autre projet peut très bien servir sur un port voisin.
  local racine; racine="$(pwd -P)"
  for pid in $(pgrep -f 'node dist/boot.js' 2>/dev/null); do
    [ "$(readlink -f "/proc/$pid/cwd" 2>/dev/null)" = "$racine" ] && echo "$pid"
  done
}

demarrer() {
  echo "▶ Serveur des parcours — port $PORT"

  # ── Rien ne doit précéder ─────────────────────────────────────────────────
  local anciens; anciens="$(processus_du_projet)"
  if [ -n "$anciens" ]; then
    echo "  résidus du projet trouvés : $anciens — arrêt"
    # shellcheck disable=SC2086
    kill -TERM $anciens 2>/dev/null || true
    sleep 3
    # shellcheck disable=SC2086
    kill -KILL $anciens 2>/dev/null || true
  fi
  port_occupe && echec "le port $PORT est déjà occupé par un tiers ; refus de démarrer"
  echo "  port libre, aucun serveur du projet en cours"

  # ── Démarrage ─────────────────────────────────────────────────────────────
  NODE_ENV=production PORT="$PORT" \
  PUBLIC_BASE_URL="$BASE" \
  ALLOWED_ORIGINS="$BASE,http://localhost:$PORT" \
    node dist/boot.js > "$JOURNAL" 2>&1 &
  local pid=$!
  echo "$pid" > "$FICHIER_PID"
  echo "  démarré, pid $pid"

  # ── Disponibilité ─────────────────────────────────────────────────────────
  local pret=1
  for _ in $(seq 1 60); do
    if curl -sf "$BASE/api/ready" >/dev/null 2>&1; then pret=0; break; fi
    kill -0 "$pid" 2>/dev/null || { echo "  le serveur s'est arrêté :"; cat "$JOURNAL"; echec "démarrage impossible"; }
    sleep 1
  done
  [ "$pret" = 0 ] || { cat "$JOURNAL"; echec "le serveur n'est pas devenu disponible en 60 s"; }
  echo "  /api/ready : prêt"

  # ── Identité de l'artefact ────────────────────────────────────────────────
  # Un parcours doit s'exécuter contre l'artefact qu'on croit avoir construit.
  local sante version sha
  sante="$(curl -s "$BASE/api/health")"
  version="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' <<< "$sante")"
  sha="$(sed -n 's/.*"gitSha":"\([^"]*\)".*/\1/p' <<< "$sante")"
  [ -n "$version" ] && [ "$version" != "inconnue" ] || echec "l'artefact n'annonce pas sa version"
  [ -n "$sha" ] && [ "$sha" != "inconnue" ] || echec "l'artefact n'annonce pas son empreinte git"
  if [ -n "${APP_VERSION_ATTENDUE:-}" ] && [ "$version" != "$APP_VERSION_ATTENDUE" ]; then
    echec "version servie « $version », attendue « $APP_VERSION_ATTENDUE »"
  fi
  if [ -n "${GIT_SHA_ATTENDU:-}" ] && [ "${GIT_SHA_ATTENDU#"$sha"}" = "$GIT_SHA_ATTENDU" ]; then
    echec "empreinte servie « $sha », attendue « $GIT_SHA_ATTENDU »"
  fi
  echo "  artefact : $version · $sha"
}

arreter() {
  local pid=""
  [ -f "$FICHIER_PID" ] && pid="$(cat "$FICHIER_PID")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "▶ Arrêt du serveur $pid (SIGTERM)"
    kill -TERM "$pid" 2>/dev/null
    for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    if kill -0 "$pid" 2>/dev/null; then
      echo "  n'a pas rendu la main en 40 s — SIGKILL"
      kill -KILL "$pid" 2>/dev/null
      sleep 2
    else
      echo "  sorti proprement"
    fi
  else
    echo "▶ Aucun serveur à arrêter (pid absent ou déjà sorti)"
  fi
  rm -f "$FICHIER_PID"
  verifier
}

verifier() {
  local restants; restants="$(processus_du_projet)"
  local libre=0; port_occupe && libre=1
  echo "  processus du projet restants : ${restants:-aucun}"
  echo "  port $PORT : $([ "$libre" = 0 ] && echo libéré || echo OCCUPÉ)"
  if [ -n "$restants" ] || [ "$libre" = 1 ]; then
    echec "PROJECT_ORPHAN_PROCESSES ≠ 0"
  fi
  echo "  PROJECT_ORPHAN_PROCESSES = 0"
}

case "${1:-}" in
  demarrer) demarrer ;;
  arreter)  arreter ;;
  verifier) verifier ;;
  *) echo "usage : $0 {demarrer|arreter|verifier}" >&2; exit 2 ;;
esac

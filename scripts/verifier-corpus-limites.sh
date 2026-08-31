#!/usr/bin/env bash
#
# scripts/verifier-corpus-limites.sh
#
# Compose ce que les bornes ont laissé passer, dans les conditions du
# conteneur de production, et vérifie ce qu'on exige d'un échec.
#
# Un tirage peut échouer : l'énoncé est du LaTeX, délibérément, et un
# enseignant peut en écrire d'invalide. Ce qui n'est pas négociable :
#
#   pas de blocage            — une limite de temps, et elle doit tenir
#   pas de plantage du moteur — un signal fatal n'est pas un échec propre
#   pas d'exécution           — le canari ne doit jamais apparaître
#   pas d'écriture au dehors  — racine en lecture seule, et on vérifie
#
# Usage : scripts/verifier-corpus-limites.sh <image> <dossier-corpus>
set -uo pipefail

IMAGE="${1:?image requise}"
RACINE="${2:?dossier du corpus requis}"
LIMITE_S="${LIMITE_COMPOSITION_S:-120}"

CANARI=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['canari'])" "$RACINE/plan.json")
echecs=0
ok() { if [ "$2" = "0" ]; then echo "    ✓ $1"; else echo "    ✗ $1 ${3:-}"; echecs=$((echecs + 1)); fi }

lire_plan() {
  python3 -c "
import json,sys
d = json.load(open(sys.argv[1]))
for e in d['plan']:
    print(e['nom'], e['attente'])
" "$RACINE/plan.json"
}

while read -r nom attente; do
  dossier="$RACINE/$nom"
  echo "── $nom (attendu : $attente)"

  debut=$(date +%s)
  # Les restrictions du conteneur de production, plus la coupure du réseau :
  # la composition n'en a pas besoin, et si elle en avait besoin il faudrait
  # le savoir ici plutôt qu'en production.
  timeout "$LIMITE_S" docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
    --read-only --tmpfs /tmp:rw,size=512m,mode=1777 \
    --cap-drop ALL --security-opt no-new-privileges --network none \
    --pids-limit 256 --memory 2g --cpus 2 \
    -v "$(realpath "$dossier")":/travail -w /travail \
    --entrypoint auto-multiple-choice "$IMAGE" \
    prepare --mode s --prefix ./ sujet.tex > "$dossier/amc.log" 2>&1
  code=$?
  duree=$(( $(date +%s) - debut ))

  # 124 : la limite de temps a coupé. C'est un blocage, pas un échec propre.
  if [ "$code" = "124" ]; then
    ok "se termine sous ${LIMITE_S} s" 1 "— coupé après ${LIMITE_S} s"
    continue
  fi
  ok "se termine (${duree} s, code $code)" 0

  # Un code au-delà de 128 vient d'un signal : le moteur est tombé.
  if [ "$code" -gt 128 ]; then
    ok "se termine sans signal fatal" 1 "— code $code"
  else
    ok "se termine sans signal fatal" 0
  fi

  [ ! -e "$dossier/$CANARI" ]; ok "aucune commande exécutée" $?

  # Rien en dehors du dossier de travail : la racine du conteneur est montée
  # en lecture seule, une écriture au dehors aurait fait échouer autre chose.
  # Ce qu'on vérifie ici, c'est qu'aucun chemin n'est remonté par `..`.
  hors=$(find "$dossier" -name '*..*' 2>/dev/null | head -1)
  [ -z "$hors" ]; ok "aucun chemin remonté hors du dossier" $?

  if [ "$attente" = "compose" ]; then
    [ -s "$dossier/sujet.pdf" ]; ok "sujet.pdf produit" $?
    [ "$code" = "0" ]; ok "code de sortie nul" $?
  else
    # Un échec doit se voir : soit AMC le dit, soit le sujet manque. C'est ce
    # second cas que `runAmc` transforme en erreur métier, parce qu'AMC rend
    # parfois un code nul sans avoir rien produit.
    if [ "$code" != "0" ] || [ ! -s "$dossier/sujet.pdf" ]; then
      ok "l'échec est visible (code $code, sujet.pdf $([ -s "$dossier/sujet.pdf" ] && echo présent || echo absent))" 0
    else
      ok "l'échec est visible" 1 "— AMC a rendu 0 et un sujet, alors qu'on attendait un échec"
    fi
  fi
done < <(lire_plan)

echo
if [ "$echecs" -eq 0 ]; then echo "CORPUS_LIMITES_AVAL = PASS"; else echo "CORPUS_LIMITES_AVAL = FAIL ($echecs)"; fi
exit "$echecs"

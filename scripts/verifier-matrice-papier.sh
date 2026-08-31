#!/usr/bin/env bash
# scripts/verifier-matrice-papier.sh
#
# Compile chaque cas de la matrice de preuve dans une image donnée et vérifie
# des invariants fonctionnels : les trois documents existent, le sujet compte
# une copie par élève, le texte attendu s'y trouve accents compris.
#
# On ne compare pas les empreintes des PDF : pdflatex horodate ses sorties, et
# deux compilations du même document diffèrent toujours d'un octet.
#
# Usage : scripts/verifier-matrice-papier.sh <image> <dossier-matrice>
set -uo pipefail

IMAGE="${1:?image requise}"
RACINE="${2:?dossier de la matrice requis}"

echecs=0
ok() { if [ "$2" = "0" ]; then echo "    ✓ $1"; else echo "    ✗ $1 ${3:-}"; echecs=$((echecs + 1)); fi }

for dossier in "$RACINE"/*/; do
  nom=$(basename "$dossier")
  echo "── $nom"
  attendu="$dossier/attendu.json"
  copies=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['copies'])" "$attendu")
  pagesmin=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['pagesMin'])" "$attendu")

  debut=$(date +%s)
  if docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
      -v "$(realpath "$dossier")":/travail -w /travail --entrypoint auto-multiple-choice \
      "$IMAGE" prepare --mode s --prefix ./ sujet.tex >"$dossier/amc.log" 2>&1; then
    ok "composition AMC ($(( $(date +%s) - debut )) s)" 0
  else
    ok "composition AMC" 1 "— voir $dossier/amc.log"
    tail -5 "$dossier/amc.log" | sed 's/^/      /'
    continue
  fi

  for f in sujet.pdf corrige.pdf catalog.pdf; do
    [ -s "$dossier/$f" ]; ok "$f produit" $?
  done

  pages=$(pdfinfo "$dossier/sujet.pdf" 2>/dev/null | awk '/^Pages:/{print $2}')
  [ "${pages:-0}" -ge "$pagesmin" ]; ok "sujet : $pages pages (≥ $pagesmin)" $?

  texte="$dossier/sujet.txt"
  pdftotext -enc UTF-8 "$dossier/sujet.pdf" "$texte" 2>/dev/null

  # Une copie par élève. Deux marqueurs indépendants, car un seul pourrait
  # survivre à une régression de mise en page sans que l'autre le fasse :
  # l'entête de la feuille-réponses, et la ligne d'association de l'élève.
  reponses=$(grep -c "Feuille de réponses" "$texte"); reponses=${reponses:-0}
  eleves=$(grep -c "Élève :" "$texte"); eleves=${eleves:-0}
  [ "$reponses" -eq "$copies" ]; ok "feuilles-réponses : $reponses (attendu $copies)" $?
  [ "$eleves" -eq "$copies" ]; ok "copies nominatives : $eleves (attendu $copies)" $?

  python3 - "$attendu" "$texte" <<'PY'
import json, sys, unicodedata
att = json.load(open(sys.argv[1]))
texte = open(sys.argv[2], encoding="utf-8", errors="replace").read()
def plat(s):  # pdftotext peut décomposer les accents ; on compare sur une forme unique
    return unicodedata.normalize("NFC", s).replace("\n", "").replace(" ", "")
t = plat(texte)
manquants = [f for f in att["attendu"] if plat(f) not in t]
print("    ✓ tous les fragments attendus présents" if not manquants
      else "    ✗ fragments absents : " + ", ".join(manquants))
sys.exit(1 if manquants else 0)
PY
  echecs=$((echecs + $?))

  # Le corrigé doit marquer les bonnes réponses, le sujet non.
  pdftotext -enc UTF-8 "$dossier/corrige.pdf" "$dossier/corrige.txt" 2>/dev/null
  [ -s "$dossier/corrige.txt" ]; ok "corrigé lisible" $?
done

echo
if [ "$echecs" -eq 0 ]; then echo "MATRICE_PAPIER = PASS"; else echo "MATRICE_PAPIER = FAIL ($echecs)"; fi
exit "$echecs"

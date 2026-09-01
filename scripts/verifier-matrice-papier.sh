#!/usr/bin/env bash
# scripts/verifier-matrice-papier.sh
#
# Compile chaque cas de la matrice de preuve dans une image donnée et vérifie
# des invariants fonctionnels : les trois documents existent, le sujet compte
# une copie par élève, le texte attendu s'y trouve accents compris.
#
# On ne compare pas les empreintes des PDF : le moteur TeX horodate ses
# sorties, et deux compilations du même document diffèrent toujours d'un
# octet. Deux preuves complètent l'extraction de texte :
#
#   - une preuve **visuelle** : la page `pageReference` des cas qui en
#     déclarent une est rendue en raster dans une image poppler épinglée
#     (docker/preuve-papier.Dockerfile), puis comparée octet à octet à la
#     référence versionnée `scripts/refs-papier/<cas>.png`. C'est elle qui
#     voit un glyphe absent, un carré, une direction cassée — ce que
#     `pdftotext` ne sait pas lire dans l'écriture arabe.
#     `MAJ_REFERENCES=1` enregistre les références au lieu de comparer.
#   - une preuve de **concurrence** : le premier cas à référence visuelle est
#     recompilé deux fois en parallèle, et chaque rendu doit être identique à
#     la référence.
#
# Tout ce qui lit les PDF (pdfinfo, pdftotext, pdftoppm, pdffonts) tourne dans
# l'image poppler épinglée : le verdict ne dépend pas de l'outillage du poste.
#
# Usage : scripts/verifier-matrice-papier.sh <image> <dossier-matrice>
set -uo pipefail

IMAGE="${1:?image requise}"
RACINE="${2:?dossier de la matrice requis}"
REFS="$(cd "$(dirname "$0")" && pwd)/refs-papier"
POPPLER_IMAGE="atelier-qcm-preuve-papier:local"

# Le contexte est le dossier docker/ : le Dockerfile ne copie rien.
docker build -q -f "$(dirname "$0")/../docker/preuve-papier.Dockerfile" \
  -t "$POPPLER_IMAGE" "$(dirname "$0")/../docker" >/dev/null || exit 1

# Un outil poppler, dans l'environnement épinglé, sur un dossier monté.
poppler() {
  local dossier="$1"; shift
  docker run --rm --user "$(id -u):$(id -g)" \
    -v "$(realpath "$dossier")":/travail -w /travail \
    --entrypoint "$1" "$POPPLER_IMAGE" "${@:2}"
}

compiler() {
  local dossier="$1" journal="$2"
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$(realpath "$dossier")":/travail -w /travail \
    --entrypoint auto-multiple-choice \
    "$IMAGE" prepare --mode s --with xelatex --prefix ./ sujet.tex \
    >"$journal" 2>&1
}

echecs=0
ok() { if [ "$2" = "0" ]; then echo "    ✓ $1"; else echo "    ✗ $1 ${3:-}"; echecs=$((echecs + 1)); fi }

# La composition ne doit jamais amputer un caractère en silence : un
# « Missing character » dans le journal est un échec, même si AMC dit oui.
sans_caractere_manquant() {
  if grep -q "Missing character" "$1"; then
    grep "Missing character" "$1" | head -3 | sed 's/^/      /'
    return 1
  fi
  return 0
}

premier_cas_reference=""

for dossier in "$RACINE"/*/; do
  nom=$(basename "$dossier")
  echo "── $nom"
  attendu="$dossier/attendu.json"
  copies=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['copies'])" "$attendu")
  pagesmin=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['pagesMin'])" "$attendu")
  police=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('policeAttendue',''))" "$attendu")
  pageref=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('pageReference',''))" "$attendu")

  debut=$(date +%s)
  if compiler "$dossier" "$dossier/amc.log"; then
    ok "composition AMC, moteur xelatex ($(( $(date +%s) - debut )) s)" 0
  else
    ok "composition AMC" 1 "— voir $dossier/amc.log"
    tail -5 "$dossier/amc.log" | sed 's/^/      /'
    continue
  fi

  sans_caractere_manquant "$dossier/amc.log"
  ok "aucun caractère sans glyphe" $?

  for f in sujet.pdf corrige.pdf catalog.pdf; do
    [ -s "$dossier/$f" ]; ok "$f produit" $?
  done

  pages=$(poppler "$dossier" pdfinfo sujet.pdf 2>/dev/null | awk '/^Pages:/{print $2}')
  [ "${pages:-0}" -ge "$pagesmin" ]; ok "sujet : $pages pages (≥ $pagesmin)" $?

  texte="$dossier/sujet.txt"
  poppler "$dossier" pdftotext -enc UTF-8 sujet.pdf sujet.txt 2>/dev/null

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
    # L'apostrophe ASCII est composée en apostrophe typographique par TeX
    # (comme du temps de T1) : même donnée, même glyphe attendu.
    s = s.replace("’", "'")
    return unicodedata.normalize("NFC", s).replace("\n", "").replace(" ", "")
t = plat(texte)
manquants = [f for f in att["attendu"] if plat(f) not in t]
print("    ✓ tous les fragments attendus présents" if not manquants
      else "    ✗ fragments absents : " + ", ".join(manquants))
sys.exit(1 if manquants else 0)
PY
  echecs=$((echecs + $?))

  # L'écriture arabe exige sa police : Amiri doit être embarquée dans le PDF.
  if [ -n "$police" ]; then
    poppler "$dossier" pdffonts sujet.pdf 2>/dev/null | grep -q "$police"
    ok "police $police embarquée" $?
  fi

  # Preuve visuelle : rendu raster déterministe, comparé octet à octet à la
  # référence versionnée. pdftotext ne lit pas l'arabe ; les pixels, si.
  if [ -n "$pageref" ]; then
    [ -n "$premier_cas_reference" ] || premier_cas_reference="$dossier"
    poppler "$dossier" pdftoppm -png -r 100 -f "$pageref" -l "$pageref" \
      -singlefile sujet.pdf rendu-reference 2>/dev/null
    if [ "${MAJ_REFERENCES:-0}" = "1" ]; then
      mkdir -p "$REFS"
      cp "$dossier/rendu-reference.png" "$REFS/$nom.png"
      echo "    ⟳ référence visuelle enregistrée : refs-papier/$nom.png"
    elif [ ! -f "$REFS/$nom.png" ]; then
      ok "référence visuelle refs-papier/$nom.png" 1 "— absente ; MAJ_REFERENCES=1 pour l'enregistrer après examen humain"
    else
      cmp -s "$dossier/rendu-reference.png" "$REFS/$nom.png"
      ok "rendu de la page $pageref identique à la référence" $?
    fi
  fi

  # Le corrigé doit marquer les bonnes réponses, le sujet non.
  poppler "$dossier" pdftotext -enc UTF-8 corrige.pdf corrige.txt 2>/dev/null
  [ -s "$dossier/corrige.txt" ]; ok "corrigé lisible" $?
done

# Deux générations concurrentes du même sujet : aucun mélange, chaque rendu
# identique à la référence. On rejoue le premier cas à référence visuelle.
if [ -n "$premier_cas_reference" ] && [ "${MAJ_REFERENCES:-0}" != "1" ]; then
  nom=$(basename "$premier_cas_reference")
  echo "── concurrence ($nom × 2)"
  pageref=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['pageReference'])" "$premier_cas_reference/attendu.json")
  pids=()
  for i in 1 2; do
    rep="$RACINE/concurrent-$i"
    rm -rf "$rep" && mkdir -p "$rep/sujet-data"
    cp "$premier_cas_reference/sujet.tex" "$rep/"
    compiler "$rep" "$rep/amc.log" &
    pids+=($!)
  done
  statut=0
  for p in "${pids[@]}"; do wait "$p" || statut=1; done
  ok "deux compositions parallèles terminées" $statut
  if [ $statut -eq 0 ]; then
    for i in 1 2; do
      rep="$RACINE/concurrent-$i"
      poppler "$rep" pdftoppm -png -r 100 -f "$pageref" -l "$pageref" \
        -singlefile sujet.pdf rendu-reference 2>/dev/null
      cmp -s "$rep/rendu-reference.png" "$REFS/$nom.png"
      ok "génération concurrente $i identique à la référence" $?
    done
  fi
fi

echo
if [ "$echecs" -eq 0 ]; then echo "MATRICE_PAPIER = PASS"; else echo "MATRICE_PAPIER = FAIL ($echecs)"; fi
exit "$echecs"

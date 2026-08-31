# Vulnérabilités résiduelles de l'image de production — candidats VEX

**Ce document ne décide rien.** Il expose, CVE par CVE, ce que la mesure permet
d'affirmer et ce qu'elle ne permet pas. La décision d'accepter ou non un risque
résiduel appartient au responsable du produit, pas à l'analyse qui la prépare.

En particulier : **P13 — `CONTAINER_VULNERABILITY_GATE` — reste `FAIL`**, et le
seuil du portail (`scripts/scan-image.sh`, zéro HIGH et zéro CRITICAL) n'a pas
été modifié.

## L'image analysée

| | |
|---|---|
| Image | `atelier-qcm:minimal` (étape `production` du `Dockerfile`) |
| Construite le | 31 août 2026 |
| Paquets installés | 179 |
| Taille | 988 Mo |
| Scanner | Trivy 0.69.1 (`sha256:1c78ed1e…`), base à jour |

## Les comptes

| Compte | Valeur |
|---|---|
| `RAW` | **62** occurrences HIGH ou CRITICAL — 14 CRITICAL, 48 HIGH |
| | soit **26** CVE distinctes, un même défaut étant compté une fois par paquet binaire |
| `NOT_AFFECTED` | **14** CVE distinctes |
| `APPLICABLE` | **0** CVE distinctes |
| `UNKNOWN` | **12** CVE distinctes |

`APPLICABLE` est à zéro non par optimisme mais par rigueur : affirmer qu'une
vulnérabilité est exploitable ici demanderait une démonstration que l'on n'a
pas faite. Les douze `UNKNOWN` sont donc à traiter comme des risques ouverts,
pas comme des acquis.

**Aucune des 26 n'a de correctif disponible en amont.** Trivy les donne toutes
avec `fix=-`, statut `affected` ou `fix_deferred`. Aucune mise à jour de paquet,
aucun rebuild, aucun changement de base Debian stable ne les fait disparaître
aujourd'hui.

## Ce qui n'est pas imputable à l'impression

L'image *sans aucune impression* — l'application seule, étape `sans-impression` —
porte déjà **3 CRITICAL et 12 HIGH**, soit 13 CVE distinctes :

| Paquet | CVE | Pourquoi il est là |
|---|---|---|
| `perl-base` | 8 CVE | paquet `Essential` de Debian : présent dans toute image Debian, retirable par aucun moyen légitime |
| `libsqlite3-0` | 2 CVE | dépendance de la base |
| `ncurses-base`, `ncurses-bin`, `libtinfo6` | 1 CVE | `Essential`/`Required` |
| `gzip` | 1 CVE | `Required` |
| `libacl1` | 1 CVE | dépendance de coreutils |

Autrement dit : **le seuil « zéro HIGH, zéro CRITICAL » est inatteignable sur
une base Debian stable**, avec ou sans AMC. C'est un fait à porter à la
décision, pas un argument pour baisser le portail.

## Analyse par CVE

### Non concernées — le code vulnérable n'est jamais chargé ni exécuté

Chaque ligne repose sur une mesure faite sur une composition réelle, décrite
dans [AMC-RUNTIME](AMC-RUNTIME.md) : trace `execve`, `%INC` de fin d'exécution,
et `LD_DEBUG=libs`.

| CVE | Sév. | Paquet | Preuve |
|---|---|---|---|
| CVE-2026-42496 | CRITICAL | `perl*` | `Archive::Tar` absent des 82 modules chargés |
| CVE-2026-42497 | HIGH | `perl*` | idem |
| CVE-2026-9538 | HIGH | `perl*` | idem |
| CVE-2026-48962 | HIGH | `perl*` | `IO::Compress` absent des modules chargés |
| CVE-2026-58015 | HIGH | `libglib2.0-0t64` | défaut dans `gio/` ; `libgio-2.0.so` n'est jamais chargée |
| CVE-2026-58016 | CRITICAL | `libglib2.0-0t64` | idem — `gio/gdbusintrospection.c` |
| CVE-2026-6653 | CRITICAL | `libxml2` | `libxml2.so` n'est jamais chargée |
| CVE-2026-66046 | HIGH | `libexpat1` | `libexpat.so` n'est jamais chargée |
| CVE-2026-11940 | HIGH | `python3.13*` | aucun interpréteur Python n'est exécuté ; `libpython3.13.so` n'est jamais chargée |
| CVE-2026-15308 | HIGH | `python3.13*` | idem |
| CVE-2026-7210 | HIGH | `python3.13*` | idem |
| CVE-2025-69720 | HIGH | `ncurses*`, `libtinfo6` | `libncursesw.so` et `libtinfo.so` ne sont jamais chargées |
| CVE-2026-41992 | HIGH | `gzip` | `gzip` n'est jamais exécuté ; le défaut est dans le décodeur LZH |
| CVE-2022-4055 | HIGH | `xdg-utils` | `xdg-email` n'est jamais exécuté |

Python et `xdg-utils` méritent un mot : ils sont dans l'image parce que
`texlive-latex-extra` et `texlive-base` en dépendent, `texlive-latex-extra`
apportant `csvsimple`, dont le gabarit se sert pour associer chaque copie à son
élève. Les retirer demanderait soit `--force-depends`, soit une réécriture du
gabarit pour se passer de `csvsimple` — l'un est interdit, l'autre serait une
modification du produit motivée par un compteur. Ils restent donc, inertes.

### Indéterminées — le composant est chargé, l'exploitabilité n'est pas établie

| CVE | Sév. | Paquet | Ce qui est établi | Ce qui manque |
|---|---|---|---|---|
| CVE-2026-13221 | CRITICAL | `perl*` | Perl est exécuté à chaque composition | savoir si un texte d'énoncé peut devenir un *motif* d'expression régulière, et non seulement un sujet |
| CVE-2026-8376 | CRITICAL | `perl*` | idem | idem |
| CVE-2026-57432 | HIGH | `perl*` | idem | savoir si `pack`/`unpack` reçoit un gabarit ou une longueur issus du contenu |
| CVE-2026-57433 | HIGH | `perl*` | `Storable.so` est chargée | savoir si `dclone` opère sur une structure dérivée du contenu |
| CVE-2026-58010 | HIGH | `libglib2.0-0t64` | `libglib-2.0.so` est chargée | savoir si `GVariant` sérialise des données issues du contenu |
| CVE-2026-58011 | HIGH | `libglib2.0-0t64` | idem | savoir si `g_date_time_get_ymd` reçoit une date du contenu |
| CVE-2026-58012 | HIGH | `libglib2.0-0t64` | idem | savoir si `g_regex_replace` reçoit un motif du contenu |
| CVE-2026-58013 | HIGH | `libglib2.0-0t64` | idem | savoir si un `GIOChannel` lit une source non maîtrisée |
| CVE-2026-58014 | HIGH | `libglib2.0-0t64` | idem | savoir si un `GKeyFile` est lu depuis un fichier non maîtrisé |
| CVE-2026-11822 | HIGH | `libsqlite3-0` | `libsqlite3.so` est chargée | le défaut vise FTS5 ; aucune table FTS n'existe dans les bases produites par AMC — vérifié sur `layout.sqlite` et `report.sqlite` — mais l'application ouvre par ailleurs MySQL, pas SQLite |
| CVE-2026-11824 | HIGH | `libsqlite3-0` | idem | le chemin de code exact n'a pas été rapproché de l'usage d'AMC |
| CVE-2026-54369 | HIGH | `libacl1` | `libacl.so.1` est chargée | savoir si une opération ACL porte sur un chemin contenant un lien symbolique choisi par un tiers |

### Ce qui atténue, sans rien prouver

Ces éléments réduisent la surface ; ils ne transforment aucune ligne ci-dessus
en `NOT_AFFECTED`, et ne doivent pas être lus comme tels.

- Le contenu composé vient d'un enseignant **authentifié**, pas d'un visiteur.
- `api/paper/amc-template.ts` refuse avant compilation les primitives
  d'exécution (`\write18`, `\input`, `\catcode`, `\def`, …), et `pdflatex`
  tourne avec `--no-shell-escape`.
- AMC est lancé par `execFile`, sans shell : aucun argument n'est réinterprété.
- Le conteneur tourne sous un utilisateur non privilégié, sans D-Bus, sans
  serveur graphique, sans réseau sortant nécessaire à la composition.
- Chaque tirage a son propre dossier de travail.

## Ce qu'il reste à décider

Trois voies, à trancher par le responsable du produit :

1. **Accepter le risque résiduel**, en publiant ce document comme attestation
   VEX et en assortissant le portail d'une liste nominative de CVE, révisée à
   chaque construction. Le portail continuerait d'échouer sur toute CVE nouvelle.
2. **Changer de base** — une image de base sans `perl-base` `Essential` ne se
   trouve pas dans l'écosystème Debian ; il faudrait quitter Debian, donc
   requalifier toute la chaîne TeX Live et AMC.
3. **Attendre les correctifs amont.** Les 26 CVE sont ouvertes chez Debian ;
   aucune date n'est annoncée.

Tant que ce choix n'est pas fait, `CONTAINER_VULNERABILITY_GATE` reste `FAIL` et
le portail reste à zéro.

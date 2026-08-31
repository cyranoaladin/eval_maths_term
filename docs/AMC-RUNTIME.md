# Le runtime AMC de l'image de production

`auto-multiple-choice` sait faire trois métiers : composer des sujets, lire des
copies scannées, et présenter tout cela dans une interface graphique. Cette
application n'en utilise qu'un. L'image de production ne contient donc que
celui-là — non pas par retrait de ce qui gênait, mais par mesure de ce qui sert.

Le périmètre est fixé par [ADR-OPTICAL-CORRECTION-BOUNDARY](ADR-OPTICAL-CORRECTION-BOUNDARY.md) :
la lecture optique est hors périmètre pour la 1.0, et reste une capacité future.

## Ce que la mesure a montré

Trois relevés, sur une composition réelle (10 questions, 4 élèves, formules,
accents, énoncé long) et non sur une lecture de la documentation.

**Les programmes exécutés.** Une trace des appels `execve` d'un
`prepare --mode s` complet ne fait apparaître que :

| Programme | Rôle |
|---|---|
| `auto-multiple-choice` | le répartiteur, un script Perl |
| `perl` | les étapes d'AMC elles-mêmes |
| `pdflatex` | la composition |
| `kpsewhich`, `kpseaccess`, `kpsestat` | résolution des fichiers TeX |
| `mktexpk`, `mf-nowin`, `gftopk`, `mktexdir`, `mktexnam`, `mktexupd` | génération de polices |
| `awk`, `basename`, `cat`, `chmod`, `mkdir`, `mv`, `rm`, `sed`, `uname` | plomberie |

Ni ImageMagick, ni GraphicsMagick, ni OpenCV, ni le moindre binaire d'interface.

**Les modules Perl chargés.** 82 modules, relevés par `%INC` en fin
d'exécution. Hors modules du cœur de Perl : `AMC::*`, `DBI`, `DBD::SQLite`,
`XML::Simple`, `XML::Writer`, `Locale::gettext`, `Glib`, `Module::Load`,
`Params::Check`, `IPC::Open3`, `Storable`. **Aucun** `Gtk3`,
**aucun** `Graphics::Magick`, **aucune** liaison OpenCV.

**Les bibliothèques natives chargées.** Relevées par `LD_DEBUG=libs` sur la
même composition : 32 objets partagés, dont `libglib-2.0`, `libgobject-2.0`,
`libsqlite3`, `libkpathsea`, `libpng16`, `libpcre2`, `libacl`, et les greffons
Perl `DBI.so`, `SQLite.so`, `Glib.so`, `Storable.so`. **Ne sont jamais
chargées** : `libgio-2.0`, `libxml2`, `libexpat`, `libncurses`, `libtinfo`,
`libpython3.13`.

## Classement des dépendances d'AMC

`auto-multiple-choice` déclare, via ses deux paquets Debian, une chaîne
complète. Voici ce que chaque morceau sert réellement.

| Dépendance déclarée | Classement | Motif |
|---|---|---|
| `perl`, `libdbi-perl`, `libdbd-sqlite3-perl` | `REQUIRED_FOR_PREPARE_S` | chargés à chaque composition |
| `libxml-simple-perl`, `libxml-writer-perl` | `REQUIRED_FOR_PREPARE_S` | chargés par AMC au démarrage |
| `liblocale-gettext-perl` | `REQUIRED_FOR_PREPARE_S` | messages traduits |
| `libglib-perl` | `REQUIRED_FOR_PREPARE_S` | `Glib.so` chargé |
| `libtext-csv-perl`, `libhash-merge-perl` | `REQUIRED_FOR_PREPARE_S` | listes d'élèves, fusion des options |
| `texlive-latex-base`, `-recommended`, `-extra` | `REQUIRED_FOR_PREPARE_S` | `automultiplechoice.sty`, `csvsimple`, `geometry` |
| `texlive-fonts-recommended`, `texlive-lang-french` | `REQUIRED_FOR_PREPARE_S` | polices, césure française |
| `libopencv-core410`, `-imgcodecs410`, `-imgproc410` | `REQUIRED_FOR_MEP_OR_SCAN` | liées à `AMC-detect` seul |
| `libgraphics-magick-perl` | `REQUIRED_FOR_MEP_OR_SCAN` | conversion des scans |
| `libcairo2`, `libpango*`, `libpoppler-glib8t64` | `REQUIRED_FOR_MEP_OR_SCAN` | annotation des copies par `AMC-buildpdf` |
| `libgtk3-perl` | `REQUIRED_FOR_GUI` | fenêtre principale |
| `libfile-mimeinfo-perl` | `REQUIRED_FOR_GUI` | ouverture des documents depuis l'interface |

Les deux seuls binaires compilés d'AMC, `AMC-detect` et `AMC-buildpdf`,
appartiennent aux deux dernières familles ; ce sont eux qui font entrer OpenCV.
`AMC-pdfformfields`, lui, n'en dépend pas.

## Comment l'image est construite

La stratégie retenue est la **stratégie A** : AMC intact, exécuté normalement,
mais posé dans un environnement réduit à ses besoins réels.

1. Une étape `paquets-amc` récupère les deux archives officielles depuis le
   miroir Debian, **épinglées à `1.7.0-3`** et vérifiées par SHA-256. Une
   modification amont fait échouer la construction. `curl` vit et meurt dans
   cette étape : il n'entre jamais dans l'image livrée.
2. L'étape `production` installe, par `apt-get` et sans recommandations, les
   seules dépendances classées `REQUIRED_FOR_PREPARE_S`.
3. Les fichiers d'AMC sont posés par `dpkg-deb -x`. Pas de `--force-depends`,
   pas de faux paquet, pas de purge après coup : les dépendances non installées
   sont celles qu'on a démontré inutiles, et elles ne sont jamais réclamées.
4. `/usr/libexec/AMC/exec` — les binaires compilés de la lecture optique — n'est
   pas conservé. Rien ne peut donc réclamer OpenCV.
5. `mktexlsr` enregistre `automultiplechoice.sty`, qui vit hors de l'arbre
   TeX Live.

| Empreinte SHA-256 | Archive |
|---|---|
| `845c7e3e67251f1891aa2bddce5a215d38ed4a5338631e736e198f7c39a5d5d8` | `auto-multiple-choice-common_1.7.0-3_all.deb` |
| `04330c73434cae767c7ed27ad1e04f8d3560403f03763834899c0af810eb6c33` | `auto-multiple-choice_1.7.0-3_amd64.deb` |

La construction s'arrête elle-même si l'un de ces éléments manque — exécutable
dans le `PATH`, répartiteur Perl, classe LaTeX résolue par `kpsewhich` — ou si
l'un de ceux-ci revient : `AMC-detect`, un paquet OpenCV, GraphicsMagick,
ImageMagick, GTK, OpenEXR, libraw, GDCM, ou une bibliothèque `libopencv*` sur
le disque.

## Ce que cela change

| | Image complète | Image réduite |
|---|---|---|
| Paquets installés | 443 | 179 |
| Taille | 3 307 Mo | 988 Mo |
| Vulnérabilités CRITICAL | 32 | 14 |
| Vulnérabilités HIGH | 139 | 48 |

Les 14 CRITICAL et 48 HIGH restantes sont analysées une par une dans
[VEX-CANDIDATES](VEX-CANDIDATES.md). Aucune n'a de correctif disponible en
amont, et 8 des 26 CVE distinctes sont déjà présentes dans l'image *sans aucune
impression* : `perl-base` est un paquet Essential de Debian.

## Preuve fonctionnelle

Réduire l'image ne vaut que si elle imprime toujours. Deux instruments :

- `scripts/matrice-preuve-papier.ts` fabrique six tirages depuis le vrai
  gabarit du produit — un élève, trente élèves, formules (`\dfrac`, racines,
  exposants, intégrale, `\mathbb{R}`), accents français, énoncé long
  multi-pages, vrai/faux ;
- `scripts/verifier-matrice-papier.sh` les compose dans une image donnée et
  vérifie des **invariants fonctionnels** : les trois documents existent, le
  nombre de pages, une feuille-réponses et une copie nominative par élève, et
  la présence de chaque fragment attendu dans le texte extrait.

On ne compare pas les PDF par empreinte : `pdflatex` horodate ses sorties, et
deux compilations du même document diffèrent toujours. En revanche le texte
extrait, lui, doit être identique — et il l'est, mot pour mot, entre l'image
complète et l'image réduite, sur les six cas.

Relevé du 31 août 2026, image `atelier-qcm:minimal` :

- matrice des six cas : `MATRICE_PAPIER = PASS` ;
- équivalence complète/réduite : identique sur les six cas, pages et texte ;
- deux tirages simultanés : aucun mélange, chacun identique à son tirage isolé ;
- recette Docker de bout en bout : **28 étapes sur 28**, dont la chaîne
  enseignant complète — créer, rédiger, importer une classe, imprimer, saisir
  les copies, relire les notes, « copie juste : 20/20 ».

## Si la lecture optique revient

Elle ne reviendra pas dans cette image. Elle aura la sienne — voir l'ADR. Le
présent document donne alors la liste exacte de ce qu'il faudra y ajouter :
tout ce qui est classé `REQUIRED_FOR_MEP_OR_SCAN`, plus les étapes `meptex` et
`prepare --mode b` que `api/paper/amc-runner.ts` a cessé d'appeler.

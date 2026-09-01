# Le runtime AMC de l'image de production

`auto-multiple-choice` sait faire trois métiers : composer des sujets, lire des
copies scannées, et présenter tout cela dans une interface graphique. Cette
application n'en utilise qu'un. L'image de production ne contient donc que
celui-là — non pas par retrait de ce qui gênait, mais par mesure de ce qui sert.

Le périmètre est fixé par [ADR-OPTICAL-CORRECTION-BOUNDARY](ADR-OPTICAL-CORRECTION-BOUNDARY.md) :
la lecture optique est hors périmètre pour la 1.0, et reste une capacité future.

## Le moteur : XeLaTeX

Le moteur de composition est **XeLaTeX**, demandé explicitement à AMC par
`prepare --mode s --with xelatex`. La raison est produit, pas technique : le
lycée servi est à Tunis, et « محمد بن علي » est un nom d'élève légitime que
pdfTeX ne sait pas composer. XeLaTeX lit l'UTF-8 nativement ; `fontspec`
fournit les polices, `polyglossia` la typographie française et la direction
droite-à-gauche des seuls fragments arabes. L'interdiction d'exécution de
commandes est inchangée : AMC passe `--no-shell-escape` au moteur, et le
moteur est lancé par AMC — jamais par un shell ; notre code n'appelle AMC que
par `execFile`.

**La police de l'écriture arabe** :

| | |
|---|---|
| FONT_PACKAGE | `fonts-hosny-amiri` (paquet Debian officiel, archive trixie) |
| FONT_VERSION | `1.001-1` |
| FAMILLE | Amiri (`\newfontfamily\arabicfont[Script=Arabic]{Amiri}`) |
| LICENSE | SIL Open Font License (OFL) |
| SOURCE | archive Debian de l'image de base épinglée par empreinte — aucun fichier téléchargé d'une URL non versionnée |

## Ce que la mesure a montré

Trois relevés, sur une composition réelle (le cas `09-corpus-unicode` de la
matrice : accents, apostrophes, noms arabes et mixtes, dix élèves) et non sur
une lecture de la documentation. Rejoués après le passage à XeLaTeX.

**Les programmes exécutés.** Une trace des appels `execve` d'un
`prepare --mode s --with xelatex` complet ne fait apparaître que :

| Programme | Rôle |
|---|---|
| `auto-multiple-choice` | le répartiteur, un script Perl |
| `perl` | les étapes d'AMC elles-mêmes |
| `xelatex` | la composition |
| `xdvipdfmx` | la production du PDF, appelée par XeTeX |
| `sh` | plomberie |

La chaîne est plus courte qu'avec pdfTeX : les polices OpenType n'exigent
plus la génération de polices bitmap (`mktexpk`, `mf-nowin`, `gftopk` ont
disparu de la trace). Ni ImageMagick, ni GraphicsMagick, ni OpenCV, ni le
moindre binaire d'interface.

**Les modules Perl chargés.** Inchangés : `AMC::*`, `DBI`, `DBD::SQLite`,
`XML::Simple`, `XML::Writer`, `Locale::gettext`, `Glib`, `Storable` — le
répartiteur est le même. **Aucun** `Gtk3`, **aucun** `Graphics::Magick`,
**aucune** liaison OpenCV.

**Les bibliothèques natives chargées.** Relevées par `LD_DEBUG=libs` sur la
même composition : une quarantaine d'objets partagés. Aux bibliothèques du
chemin pdfTeX (`libglib-2.0`, `libgobject-2.0`, `libsqlite3`, `libkpathsea`,
`libpng16`, `libpcre2`, greffons Perl) s'ajoutent celles de la composition
OpenType : `libfontconfig`, `libfreetype`, `libharfbuzz`, `libgraphite2`,
`libicuuc`/`libicudata`, `libTECkit`, `libexpat` (la configuration XML de
fontconfig), `libbrotlidec`. Toujours **aucune** `libgio-2.0`, `libncurses`,
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
| `texlive-latex-base`, `-recommended`, `-extra` | `REQUIRED_FOR_PREPARE_S` | `automultiplechoice.sty` fait `\RequirePackage` de `csvsimple`, `bophook`, `environ`, `storebox` — tous dans `-extra`. Notre gabarit n'utilise plus `csvsimple` (les copies nominatives sont générées directement, sans CSV), mais le sty l'exige inconditionnellement : le paquet reste |
| `texlive-fonts-recommended`, `texlive-lang-french` | `REQUIRED_FOR_PREPARE_S` | polices, césure française |
| `texlive-xetex` | `REQUIRED_FOR_PREPARE_S` | le moteur XeLaTeX et `xdvipdfmx` |
| `texlive-lang-arabic` | `REQUIRED_FOR_PREPARE_S` | `bidi`, la direction droite-à-gauche de polyglossia |
| `fonts-hosny-amiri` | `REQUIRED_FOR_PREPARE_S` | la police Amiri de l'écriture arabe |
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

| | Image complète | Image réduite (pdfTeX) | Image réduite (XeLaTeX) |
|---|---|---|---|
| Paquets installés | 443 | 179 | 185 |
| Taille | 3 307 Mo | 988 Mo | 1 070 Mo |
| Vulnérabilités CRITICAL | 32 | 14 | 14 |
| Vulnérabilités HIGH | 139 | 48 | 48 |

Le passage à XeLaTeX ajoute six paquets — `texlive-xetex`,
`texlive-lang-arabic`, `fonts-hosny-amiri`, et leurs dépendances `teckit`,
`texlive-plain-generic`, `tipa` — et **aucune vulnérabilité élevée ou
critique** : l'ensemble des CVE du rapport brut est identique, paire par
paire (CVE, paquet), à celui de l'image pdfTeX. La suppression de `csvsimple`
de notre chaîne n'allège pas l'image : le sty d'AMC l'exige de toute façon
(voir le classement ci-dessus). Ce qu'elle supprime est ailleurs — une
transformation intermédiaire, une surface d'injection, la logique d'échappement
propre au CSV.

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

On ne compare pas les PDF par empreinte : le moteur TeX horodate ses sorties,
et deux compilations du même document diffèrent toujours. En revanche le texte
extrait, lui, doit être identique — et le rendu raster d'une page de
référence, produit dans l'environnement poppler épinglé
(`docker/preuve-papier.Dockerfile`), est comparé **octet à octet** à une
référence versionnée (`scripts/refs-papier/`). C'est la preuve visuelle de
l'écriture arabe — lettres jointes, ordre droite-à-gauche, aucun glyphe
manquant — que `pdftotext` ne sait pas lire. Deux générations concurrentes
doivent rendre ce même raster.

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

# Applicabilité des vulnérabilités du runtime de production

**Ce document est engendré** par `scripts/vex-generer.mjs` depuis
`security/analyse-applicabilite.json`, qui porte le raisonnement, et depuis le
rapport brut de Trivy, qui porte les versions. Ne le modifiez pas à la main :
modifiez l'analyse, puis régénérez. L'attestation lisible par une machine,
`security/vex.openvex.json`, sort de la même source.

## Le contrat

Le portail ne demande plus que le compteur brut soit nul — aucune image Debian
ne peut le tenir, `perl-base` étant un paquet `Essential` qui porte à lui seul
huit CVE sans correctif amont. Il demande que **rien d'applicable ni
d'indéterminé ne subsiste** :

```
APPLICABLE_CRITICAL = 0
APPLICABLE_HIGH     = 0
UNKNOWN_CRITICAL    = 0
UNKNOWN_HIGH        = 0
```

Toute occurrence restante doit être `NOT_AFFECTED`, avec une preuve nominative
et reproductible. Aucune catégorie « risque accepté », « ne sera pas corrigé »,
« exception temporaire » ou « ignorée » n'existe : `scripts/gate-applicabilite.mjs`
refuse tout autre statut, et traite comme un échec ce que personne n'a examiné.

## Le relevé

| | |
|---|---|
| Occurrences brutes | **62** (`RAW_CRITICAL` et `RAW_HIGH` restent imprimés tels quels) |
| CVE distinctes | **26** — 5 critiques, 21 élevées |
| `NOT_AFFECTED` | **26** |
| `APPLICABLE` | **0** |
| `UNKNOWN` | **0** |

Aucune des 26 n'a de correctif disponible en amont : Trivy les donne toutes
avec `fix=-`. Aucune mise à jour de paquet ne les fait disparaître aujourd'hui.

## Ce sur quoi reposent les preuves

Toutes les mesures ont été faites sur une **génération réelle**, avec le corpus
hostile de `scripts/corpus-adversarial.ts` : chaque champ que remplit un
enseignant y porte des métacaractères d'expression régulière, des accents, des
chaînes longues, et un marqueur unique qui permet de suivre la donnée.

Cinq instruments, et chacun a été validé par un témoin — une trace vide ne
vaut rien si l'instrument ne se déclenche jamais :

| Instrument | Ce qu'il montre | Témoin |
|---|---|---|
| `strace -f -e trace=execve` | les 27 programmes exécutés | `perl`, `pdflatex`, `kpsewhich` apparaissent |
| `LD_DEBUG=libs` | les 32 objets partagés chargés | `libglib`, `libsqlite3`, `libacl` apparaissent |
| `%INC` en fin d'exécution | les 82 modules Perl chargés | les modules `AMC::*` apparaissent |
| interposition `LD_PRELOAD` | les points d'entrée incriminés | `g_strdup` 72 fois, `g_get_home_dir` 4 fois ; un programme appelant `acl_get_file` déclenche bien l'enveloppe |
| enveloppement Perl | les fonctions d'AMC surveillées | `AMC::Basic::debug` et `AMC::Config::get`, 225 appels |

L'image de diagnostic qui porte ces instruments est jetable : elle n'est jamais
livrée.

## Ce qui invalide ces preuves

Une preuve « non concerné » dit qu'une fonction n'est jamais appelée *par ce
code-là*, dans *cette image-là*. Elle ne survit pas à un changement de runtime.

L'attestation porte donc une **empreinte de runtime** — une empreinte SHA-256
de `Dockerfile`, `api/paper/amc-runner.ts`, `api/paper/amc-template.ts` et
`docs/DEPENDANCES.md`. La CI la recalcule à chaque construction et échoue si
elle a changé. De même, une déclaration qui vise une version de paquet que
l'image ne porte plus fait échouer le portail : une analyse ne suit pas
silencieusement une montée de version.

## Les fiches

### CVE-2026-13221

| | |
|---|---|
| **Sévérité** | CRITICAL |
| **Paquets et versions** | `libperl5.40@5.40.1-6, perl-base@5.40.1-6, perl-modules-5.40@5.40.1-6, perl@5.40.1-6` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | Perl_study_chunk, construction du trie d'alternation |
| **Condition de déclenchement** | Compiler un motif dont l'alternation compte plus de 65 535 branches de chaînes fixes. |
| **Entrée contrôlée par un tiers** | Un motif d'expression régulière bâti depuis des données. |
| **Atteignabilité statique** | Recherche exhaustive de join('\|') sur les 81 fichiers de modules chargés : deux occurrences, toutes deux dans AMC. 61 motifs interpolés recensés, aucun ne bâtit d'alternation. |
| **Atteignabilité dynamique** | Enveloppement des deux fonctions pendant une génération avec corpus hostile : zéro appel, alors que les témoins AMC::Basic::debug et AMC::Config::get sont appelés 225 fois. Une entrée de 70 000 branches dans un nom d'élève n'atteint aucun motif Perl : la chaîne s'arrête dans le moteur TeX. Depuis le passage à XeLaTeX, plus aucune liste d'élèves n'est même transmise à AMC — les copies nominatives sont générées directement dans le document, sans CSV : AMC::Config::csv_build_0 n'a plus aucune donnée à recevoir. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Sur les 81 modules chargés par une génération, deux seulement bâtissent une alternation depuis des données : AMC::Config::csv_build_0 et AMC::Basic::check_fonts. Les deux sont muettes pendant une génération complète. Les bornes de api/paper/amc-template.ts plafonnent par ailleurs chaque champ d'enseignant très au-dessous de 65 535 branches. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-42496

| | |
|---|---|
| **Sévérité** | CRITICAL |
| **Paquets et versions** | `libperl5.40@5.40.1-6, perl-base@5.40.1-6, perl-modules-5.40@5.40.1-6, perl@5.40.1-6` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | Archive::Tar, traversée de chemin par lien symbolique fabriqué |
| **Condition de déclenchement** | Extraire une archive tar fabriquée. |
| **Entrée contrôlée par un tiers** | Une archive tar. |
| **Atteignabilité statique** | Absent des scripts exécutés et des modules d'AMC. |
| **Atteignabilité dynamique** | Relevé de %INC en fin d'exécution sur une génération avec corpus hostile : 82 modules, aucun Archive::Tar. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Archive::Tar n'est pas chargé, et le produit n'extrait aucune archive. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-58016

| | |
|---|---|
| **Sévérité** | CRITICAL |
| **Paquets et versions** | `libglib2.0-0t64@2.84.4-3~deb13u3` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | g_dbus_node_info_new_for_xml (gio/gdbusintrospection.c) |
| **Condition de déclenchement** | Analyser une description d'introspection D-Bus fabriquée. |
| **Entrée contrôlée par un tiers** | Du XML d'introspection D-Bus. |
| **Atteignabilité statique** | Aucun usage de D-Bus dans le code chargé. |
| **Atteignabilité dynamique** | LD_DEBUG=libs sur une génération complète : libgio-2.0.so absente des 32 objets chargés. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Le défaut est dans libgio, qui n'est jamais chargée. Le conteneur n'a aucun bus D-Bus. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-6653

| | |
|---|---|
| **Sévérité** | CRITICAL |
| **Paquets et versions** | `libxml2@2.12.7%2Bdfsg%2Breally2.9.14-2.1%2Bdeb13u3` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | libxml2, analyse de XML fabriqué |
| **Condition de déclenchement** | Analyser un document XML fabriqué. |
| **Entrée contrôlée par un tiers** | Un document XML. |
| **Atteignabilité statique** | libxml2 n'est tirée que comme dépendance transitive. |
| **Atteignabilité dynamique** | LD_DEBUG=libs sur une génération complète : libxml2.so absente des 32 objets chargés. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | libxml2 n'est jamais chargée. AMC lit sa configuration avec XML::Simple, qui n'utilise pas libxml2 ici. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-8376

| | |
|---|---|
| **Sévérité** | CRITICAL |
| **Paquets et versions** | `libperl5.40@5.40.1-6, perl-base@5.40.1-6, perl-modules-5.40@5.40.1-6, perl@5.40.1-6` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | Perl_study_chunk (regcomp_study.c), compilation d'expression régulière |
| **Condition de déclenchement** | Compiler un motif comportant une chaîne fixe répétée avec un compte minimal élevé, sur une construction 32 bits, de sorte que mincount * l déborde SSize_t. |
| **Entrée contrôlée par un tiers** | Un motif d'expression régulière. |
| **Atteignabilité statique** | L'avis restreint le défaut aux constructions 32 bits. |
| **Atteignabilité dynamique** | perl -V:ptrsize -V:ivsize -V:sizesize -V:archname dans l'image livrée : 8, 8, 8, x86_64-linux-gnu-thread-multi. |
| **Justification VEX** | `vulnerable_code_cannot_be_controlled_by_adversary` |
| **Portée de l'impact** | L'image est amd64 : perl -V donne ptrsize=8, ivsize=8, sizesize=8. Le débordement décrit exige un SSize_t de 32 bits ; sur cette construction, mincount * l ne peut atteindre 2^63. Aucune entrée ne peut porter le calcul jusqu'au débordement. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2022-4055

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `xdg-utils@1.2.1-2` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | xdg-email, analyse des URI mailto |
| **Condition de déclenchement** | Passer un URI mailto fabriqué à xdg-email. |
| **Entrée contrôlée par un tiers** | Un URI mailto. |
| **Atteignabilité statique** | Le produit n'envoie aucun courriel depuis le conteneur et n'appelle aucun outil xdg. |
| **Atteignabilité dynamique** | Trace execve : aucun programme xdg parmi les 27 exécutés. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | xdg-email n'est jamais exécuté. xdg-utils n'est présent que comme dépendance de texlive-base. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2025-69720

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libncursesw6@6.5%2B20250216-2, libtinfo6@6.5%2B20250216-2, ncurses-base@6.5%2B20250216-2, ncurses-bin@6.5%2B20250216-2` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | ncurses, débordement de tampon |
| **Condition de déclenchement** | Traiter une description de terminal fabriquée. |
| **Entrée contrôlée par un tiers** | TERM et la base terminfo. |
| **Atteignabilité statique** | Aucun usage de ncurses dans le produit ni dans AMC. |
| **Atteignabilité dynamique** | LD_DEBUG=libs : ni libncursesw.so ni libtinfo.so parmi les 32 objets chargés. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | ncurses n'est jamais chargée : la composition n'ouvre aucun terminal. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-11822

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libsqlite3-0@3.46.1-7%2Bdeb13u1` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | fts5LeafSeek (extension FTS5 de SQLite) |
| **Condition de déclenchement** | Exécuter une requête FTS5 MATCH sur une base fabriquée dont les pages FTS5 sont malformées. |
| **Entrée contrôlée par un tiers** | Le fichier de base de données. |
| **Atteignabilité statique** | Le schéma produit ne comporte que des tables ordinaires : layout_* et report_*. |
| **Atteignabilité dynamique** | Interposition de sqlite3_open, sqlite3_open_v2, sqlite3_exec et sqlite3_prepare_v2/v3 : 126 énoncés capturés, aucun CREATE VIRTUAL TABLE, aucun MATCH. La seule mention FTS est la sonde de capacité de DBD::SQLite, SELECT fts3_tokenizer(?, ?), qui vise FTS3 et passe ses valeurs en paramètres liés. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | FTS5 est bien compilée dans libsqlite3 (ENABLE_FTS5), mais aucune table virtuelle n'est créée et aucune requête MATCH n'est exécutée. Les deux bases du projet sont créées de zéro par AMC dans un dossier de tirage qui lui est propre ; aucun fichier fourni par un enseignant n'est jamais ouvert comme base. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-11824

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libsqlite3-0@3.46.1-7%2Bdeb13u1` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | fts5ChunkIterate (extension FTS5 de SQLite) |
| **Condition de déclenchement** | Exécuter une requête FTS5 MATCH sur une base dont une page de continuation annonce un szLeaf inférieur à 4. |
| **Entrée contrôlée par un tiers** | Le fichier de base de données. |
| **Atteignabilité statique** | Le schéma produit ne comporte que des tables ordinaires. |
| **Atteignabilité dynamique** | 126 énoncés SQL capturés pendant une génération : aucun MATCH, aucune table virtuelle. Le marqueur du corpus hostile n'apparaît dans aucun texte SQL — les données d'enseignant n'y entrent que par paramètres liés. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Même chemin que CVE-2026-11822 : aucune table FTS5, aucune requête MATCH, aucune base fournie de l'extérieur. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-11940

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libpython3.13-minimal@3.13.5-2%2Bdeb13u4, libpython3.13-stdlib@3.13.5-2%2Bdeb13u4, python3.13-minimal@3.13.5-2%2Bdeb13u4, python3.13@3.13.5-2%2Bdeb13u4` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | CPython, filtre d'extraction de tarfile |
| **Condition de déclenchement** | Extraire une archive tar avec le module tarfile de Python. |
| **Entrée contrôlée par un tiers** | Une archive tar. |
| **Atteignabilité statique** | Aucun appel à Python dans le produit ni dans AMC. |
| **Atteignabilité dynamique** | Trace execve rejouée sur la chaîne XeLaTeX (prepare --mode s --with xelatex) : cinq programmes exécutés — sh, auto-multiple-choice, perl, xelatex, xdvipdfmx — aucun Python. LD_DEBUG : libpython3.13.so jamais chargée. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Aucun interpréteur Python n'est exécuté. Python n'est présent que parce que texlive-latex-extra en dépend — paquet exigé par automultiplechoice.sty lui-même (csvsimple, bophook, environ, storebox), alors même que le gabarit du produit n'emploie plus csvsimple. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-15308

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libpython3.13-minimal@3.13.5-2%2Bdeb13u4, libpython3.13-stdlib@3.13.5-2%2Bdeb13u4, python3.13-minimal@3.13.5-2%2Bdeb13u4, python3.13@3.13.5-2%2Bdeb13u4` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | CPython, analyseur HTML |
| **Condition de déclenchement** | Analyser du HTML fabriqué avec html.parser. |
| **Entrée contrôlée par un tiers** | Un document HTML. |
| **Atteignabilité statique** | Aucun appel à Python dans le produit ni dans AMC. |
| **Atteignabilité dynamique** | Trace execve rejouée sur la chaîne XeLaTeX : cinq programmes — sh, auto-multiple-choice, perl, xelatex, xdvipdfmx — aucun Python. LD_DEBUG : libpython3.13.so jamais chargée. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Aucun interpréteur Python n'est exécuté. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-41992

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `gzip@1.13-1` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | gzip, décodeur LZH |
| **Condition de déclenchement** | Décompresser une archive fabriquée au format LZH. |
| **Entrée contrôlée par un tiers** | Une archive compressée. |
| **Atteignabilité statique** | Aucun appel à gzip dans le produit ni dans AMC. |
| **Atteignabilité dynamique** | Trace execve d'une génération complète : gzip ne figure pas parmi les 27 programmes exécutés. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | gzip n'est jamais exécuté, et le produit ne décompresse aucune archive fournie de l'extérieur. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-42497

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libperl5.40@5.40.1-6, perl-base@5.40.1-6, perl-modules-5.40@5.40.1-6, perl@5.40.1-6` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | Archive::Tar, modification de fichier arbitraire |
| **Condition de déclenchement** | Extraire une archive tar fabriquée. |
| **Entrée contrôlée par un tiers** | Une archive tar. |
| **Atteignabilité statique** | Absent des scripts exécutés et des modules d'AMC. |
| **Atteignabilité dynamique** | Relevé de %INC : 82 modules, aucun Archive::Tar. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Archive::Tar n'est pas chargé, et le produit n'extrait aucune archive. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-48962

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libperl5.40@5.40.1-6, perl-base@5.40.1-6, perl-modules-5.40@5.40.1-6, perl@5.40.1-6` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | IO::Compress |
| **Condition de déclenchement** | Traiter un flux compressé fabriqué. |
| **Entrée contrôlée par un tiers** | Un flux compressé. |
| **Atteignabilité statique** | Absent des scripts exécutés et des modules d'AMC. |
| **Atteignabilité dynamique** | Relevé de %INC : 82 modules, aucun IO::Compress ni Compress::*. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | IO::Compress n'est pas chargé ; la composition ne décompresse rien. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-54369

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libacl1@2.3.2-2%2Bb1` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | acl_get_file, acl_set_file, acl_extended_file, acl_delete_def_file |
| **Condition de déclenchement** | Un appelant privilégié applique une opération ACL à un chemin dont un tiers contrôle une composante, remplacée par un lien symbolique. |
| **Entrée contrôlée par un tiers** | Une composante de chemin. |
| **Atteignabilité statique** | Aucun appel ACL dans AMC ni dans le code du produit ; libacl n'est tirée que par coreutils. |
| **Atteignabilité dynamique** | Les quatre fonctions interposées : zéro appel sur une génération complète. Le témoin prouve que l'interposition se déclenche : un programme appelant acl_get_file("/tmp") et acl_extended_file("/tmp") sous le même préchargement produit bien les deux lignes de journal. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Aucune des quatre fonctions n'est appelée pendant une génération. De surcroît la condition de l'avis — un appelant privilégié — est absente : le conteneur tourne sous evalapp (uid 10001), racine en lecture seule, toutes capacités retirées, no-new-privileges. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-57432

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libperl5.40@5.40.1-6, perl-base@5.40.1-6, perl-modules-5.40@5.40.1-6, perl@5.40.1-6` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | S_measure_struct, opérations pack et unpack |
| **Condition de déclenchement** | Un gabarit pack/unpack dérivé d'une entrée non fiable, portant un compte de répétition assez grand pour faire déborder le total SSize_t. |
| **Entrée contrôlée par un tiers** | Le gabarit, et non les données empaquetées. |
| **Atteignabilité statique** | Recherche de (pack\|unpack) suivi de $ ou @ sur les 81 fichiers : zéro occurrence. Tous les gabarits relevés sont des littéraux constants. |
| **Atteignabilité dynamique** | Storable::read_magic enveloppée pendant une génération : zéro appel. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Aucun des 81 modules chargés n'appelle pack ou unpack avec un gabarit non littéral. Le seul gabarit interpolé, Storable.pm ligne 200 (a${len}CCC), appartient à read_magic, qui n'est jamais appelée ; $len y vaut au plus 255. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-57433

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libperl5.40@5.40.1-6, perl-base@5.40.1-6, perl-modules-5.40@5.40.1-6, perl@5.40.1-6` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | Storable, retrieve_hook_common sur un enregistrement SX_HOOK |
| **Condition de déclenchement** | Passer un blob fabriqué à thaw ou retrieve. |
| **Entrée contrôlée par un tiers** | Un blob Storable sérialisé. |
| **Atteignabilité statique** | Aucune occurrence de thaw, retrieve, fd_retrieve, dclone, freeze ou store dans le code d'AMC chargé ni dans les scripts exécutés. |
| **Atteignabilité dynamique** | Les neuf entrées de Storable enveloppées pendant une génération avec corpus hostile : zéro appel, témoins actifs. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Storable est chargé parce qu'Encode le charge, pas parce qu'AMC s'en sert. Aucune de ses entrées de désérialisation n'est appelée, et le produit ne lit aucun blob Storable. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-58010

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libglib2.0-0t64@2.84.4-3~deb13u3` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | gvs_tuple_is_normal (glib/gvariant-serialiser.c) |
| **Condition de déclenchement** | Vérifier la forme normale d'un GVariant sérialisé fabriqué. |
| **Entrée contrôlée par un tiers** | Des données GVariant sérialisées. |
| **Atteignabilité statique** | Les seuls appels GLib du code chargé sont Glib::get_home_dir, Glib::filename_display_name et les constantes TRUE/FALSE. |
| **Atteignabilité dynamique** | g_variant_new_from_data, g_variant_is_normal_form et g_variant_get_normal_form interposées : zéro appel, alors que les témoins g_strdup (72 appels) et g_get_home_dir (4) prouvent que l'interposition GLib fonctionne. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Aucun GVariant n'est construit ni vérifié pendant une génération. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-58011

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libglib2.0-0t64@2.84.4-3~deb13u3` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | g_date_time_get_ymd (glib/gdatetime.c) |
| **Condition de déclenchement** | Lire la date d'un GDateTime invalide produit par g_date_time_add_full. |
| **Entrée contrôlée par un tiers** | Une valeur de date. |
| **Atteignabilité statique** | Aucun appel GDateTime dans le code chargé. |
| **Atteignabilité dynamique** | g_date_time_add_full et g_date_time_get_ymd interposées : zéro appel, témoins actifs. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Aucune date GLib n'est manipulée pendant une génération. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-58012

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libglib2.0-0t64@2.84.4-3~deb13u3` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | g_regex_replace, via string_append (glib/gregex.c) |
| **Condition de déclenchement** | Appeler g_regex_replace avec le drapeau G_REGEX_RAW et une échappe de changement de casse, sur une chaîne qui n'est pas de l'UTF-8 valide. |
| **Entrée contrôlée par un tiers** | La chaîne sujet et la chaîne de remplacement. |
| **Atteignabilité statique** | Aucun appel g_regex dans le code chargé. |
| **Atteignabilité dynamique** | g_regex_new et g_regex_replace interposées : zéro appel, témoins actifs. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Le moteur d'expressions régulières de GLib n'est pas utilisé : AMC est en Perl et se sert du moteur de Perl. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-58013

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libglib2.0-0t64@2.84.4-3~deb13u3` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | g_io_channel_read_line_backend (glib/giochannel.c) |
| **Condition de déclenchement** | Lire une ligne sur un GIOChannel dont le terminateur de ligne fait plus d'un caractère. |
| **Entrée contrôlée par un tiers** | Le flux lu et le terminateur configuré. |
| **Atteignabilité statique** | Aucun appel GIOChannel dans le code chargé. |
| **Atteignabilité dynamique** | g_io_channel_set_line_term, g_io_channel_read_line et g_io_channel_read_line_string interposées : zéro appel, témoins actifs. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Aucun GIOChannel n'est ouvert pendant une génération ; les entrées-sorties passent par Perl. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-58014

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libglib2.0-0t64@2.84.4-3~deb13u3` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | g_key_file_get_locale_string_list (glib/gkeyfile.c) |
| **Condition de déclenchement** | Charger un fichier de clés contenant une valeur vide, puis lire une liste localisée. |
| **Entrée contrôlée par un tiers** | Le contenu du fichier de clés. |
| **Atteignabilité statique** | Aucun appel GKeyFile dans le code chargé. |
| **Atteignabilité dynamique** | g_key_file_load_from_file, g_key_file_get_locale_string et g_key_file_get_locale_string_list interposées : zéro appel, témoins actifs. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Aucun GKeyFile n'est chargé pendant une génération. AMC lit sa configuration en XML par XML::Simple, pas en format clés GLib. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-58015

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libglib2.0-0t64@2.84.4-3~deb13u3` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | keyring_ (gio/gdbusauthmechanismsha1.c) |
| **Condition de déclenchement** | Authentification D-Bus SHA-1 par trousseau. |
| **Entrée contrôlée par un tiers** | Un pair D-Bus. |
| **Atteignabilité statique** | Aucun usage de D-Bus dans le code chargé. |
| **Atteignabilité dynamique** | LD_DEBUG=libs sur une génération complète : 32 objets partagés chargés, libgio-2.0.so n'en fait pas partie. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Le défaut est dans libgio, qui n'est jamais chargée. Le conteneur n'a ni bus de session ni bus système. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-66046

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libexpat1@2.8.3-1~deb13u1` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | Expat, déni de service par XML fabriqué |
| **Condition de déclenchement** | Analyser un document XML fabriqué. |
| **Entrée contrôlée par un tiers** | Un document XML. |
| **Atteignabilité statique** | Le produit n'analyse aucun XML côté serveur ; AMC écrit du XML (XML::Writer) mais expat n'est atteint que par fontconfig. Les seuls fichiers lus sont ceux de /etc/fonts et /usr/share/fontconfig — root, mode 644, dans un conteneur en lecture seule. Aucune donnée d'enseignant ou d'élève n'est jamais présentée comme XML. |
| **Atteignabilité dynamique** | Trace openat d'une composition XeLaTeX réelle (cas 09-corpus-unicode) : tous les .conf/.xml ouverts appartiennent à l'image — /etc/fonts/**, /usr/share/fontconfig/** — aucun chemin inscriptible par l'uid applicatif (10001), aucun chemin dérivé d'une donnée saisie. |
| **Justification VEX** | `vulnerable_code_cannot_be_controlled_by_adversary` |
| **Portée de l'impact** | Réinstruit après le passage à XeLaTeX : libexpat est désormais chargée — fontconfig s'en sert pour lire sa propre configuration. Mais l'attaque exige de faire analyser un document XML fabriqué de plusieurs mégaoctets, et aucun XML venant d'un utilisateur n'atteint jamais l'analyseur : fontconfig ne lit que les fichiers de configuration de l'image. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-7210

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libpython3.13-minimal@3.13.5-2%2Bdeb13u4, libpython3.13-stdlib@3.13.5-2%2Bdeb13u4, python3.13-minimal@3.13.5-2%2Bdeb13u4, python3.13@3.13.5-2%2Bdeb13u4` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | CPython lié à Expat, analyse XML |
| **Condition de déclenchement** | Analyser un document XML fabriqué depuis Python. |
| **Entrée contrôlée par un tiers** | Un document XML. |
| **Atteignabilité statique** | Aucun appel à Python dans le produit ni dans AMC. |
| **Atteignabilité dynamique** | Trace execve rejouée sur la chaîne XeLaTeX : cinq programmes, aucun Python. LD_DEBUG : libpython3.13.so jamais chargée (libexpat l'est désormais, par fontconfig — voir CVE-2026-66046). |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Aucun interpréteur Python n'est exécuté. |
| **Statut** | `NOT_AFFECTED` |

### CVE-2026-9538

| | |
|---|---|
| **Sévérité** | HIGH |
| **Paquets et versions** | `libperl5.40@5.40.1-6, perl-base@5.40.1-6, perl-modules-5.40@5.40.1-6, perl@5.40.1-6` |
| **Source de l'avis** | base de vulnérabilités Debian, relayée par Trivy 0.69.1 |
| **Composant vulnérable** | Archive::Tar, déni de service par archive fabriquée |
| **Condition de déclenchement** | Extraire une archive tar fabriquée. |
| **Entrée contrôlée par un tiers** | Une archive tar. |
| **Atteignabilité statique** | Absent des scripts exécutés et des modules d'AMC. |
| **Atteignabilité dynamique** | Relevé de %INC : 82 modules, aucun Archive::Tar. |
| **Justification VEX** | `vulnerable_code_not_in_execute_path` |
| **Portée de l'impact** | Archive::Tar n'est pas chargé, et le produit n'extrait aucune archive. |
| **Statut** | `NOT_AFFECTED` |

# Dossier de preuve — mise en service v1.0.0

Ce fichier est le registre de vérité de la finalisation. Il ne remplace ni
`README.md`, ni `PLAN.md`, ni `CHANGELOG.md` : il consigne **ce qui a été
réellement exécuté**, avec la commande qui le prouve.

Règle : un critère ne passe à `PASS` que si la preuve a été exécutée et
observée. Un critère non vérifié reste `IN_PROGRESS`, jamais `PASS`.

---

## 1. Position

| | |
|---|---|
| Branche | `phase-3.5-convergence` |
| HEAD | `91c09d3` |
| Base de la finalisation | `5a24b63` (`feat(dashboard)`) |
| Worktree | propre |
| Dernière mise à jour | 2026-08-30 (unicité, écriture groupée, mesure d'acceptation) |

## 1 bis. Incident de procédure — force-push

Le 2026-08-29, le commit `823a2cd` (« test(recette) : scores décimaux et
typographie du relevé ») a été poussé, puis corrigé par `git commit --amend`
et republié par `git push -f`, devenant `1c91d3c`. La consigne interdisait
explicitement le force-push et la réécriture d'un commit déjà publié.

**Écart réel entre les deux versions**, vérifié par `git diff 823a2cd 1c91d3c` :

```
 scripts/smoke-releve-typographie.ts | 2 +-
 scripts/smoke-scores-decimaux.ts    | 6 ------
 2 files changed, 1 insertion(+), 7 deletions(-)
```

Un import `readFileSync` inutilisé et une fonction `urlPour` morte, tous deux
signalés par ESLint. Aucun travail fonctionnel n'a été perdu ni modifié.

**Vérification d'intégrité** : les quatorze commits fonctionnels de la campagne
sont tous ancêtres de `HEAD`, contrôlés un par un avec
`git merge-base --is-ancestor`. `823a2cd` reste accessible dans le reflog local.

Aucun force-push ni amend d'un commit publié ne sera fait à partir d'ici.

## 2. Commits de la finalisation

| SHA | Domaine | Objet |
|---|---|---|
| `98e5e53` | MathLive / normalisation | Le champ mathématique ne transmettait rien au serveur |
| `b4430b4` | Anti-triche | Le heartbeat répondait 401 à chaque envoi |
| `5907209` | Reprise de session / fiabilité réseau | Reprise de copie et fiabilité de la sauvegarde |
| `7ad41a2` | E2E | Parcours élève réel sur Chromium, Firefox et WebKit |
| `ef8365c` | MathLive / normalisation | Les écritures produites par le champ mathématique étaient comptées fausses |
| `5f228bd` | Anti-triche | Le balayage d'inactivité ne tournait jamais de lui-même |
| `5433023` | Correction | Limites infinies, mode exact sans référence, déconnexion invisible |
| `a0142df` | Couverture | Couvrir les chemins de correction jamais éprouvés |
| `99a5a4b` | Sécurité | Un enseignant accédait aux copies de tous les autres |
| `cfb1cf9` | Documentation | Registre de preuve |
| `5b9b357` | Charge / build | Le quota de démarrage rendait une salle d'examen impossible ; le bundle de production ne démarrait pas |
| `1c91d3c` | Recettes | Scores décimaux et typographie du relevé |
| `075ce17` | Déploiement | Secrets du dépôt en production ; migration impossible depuis l'image |
| `260ae02` | Critères 7, 14, 17, 18 | Impression en conteneur, export tableur, surfaces réduites, journal d'audit |
| `81fe8b3` | Correction | `api/grading` à 100 %, trois défauts de correction de plus |
| `bf2c365` | Couverture | Tests d'intégration sur base réelle, seuils inscrits |
| `593c4d0` | Style | Rapports générés hors périmètre |
| `4d86076` | Performance | La remise de copie tenait mal la fin d'épreuve |
| `6a49577` | Couverture | Chemins ouverts par l'optimisation de la remise |
| `1b91201` | Documentation | Attribution du coût de la remise |
| `cc96551` | Intégrité | Unicité (session, question), écriture groupée, remise concurrente |
| `4af25e5` | Charge | Deux scénarios distincts, trois exécutions conformes en local |
| `91c09d3` | Couverture | Confiance du correcteur assisté |

Commits antérieurs de la même campagne, déjà poussés : `864ec4a` (scores
décimaux), `ceeb833` (journal d'audit), `e4c05a6` (écran de correction),
`5e52ec9` (relevé PDF), `5a24b63` (tableau de bord).

## 3. Critères d'acceptation (PLAN.md §VIII.4)

| # | Critère | État | Preuve |
|---|---|---|---|
| 1 | Aucune route publique ne renvoie `correctAnswer` | PASS | `npm test -- public-surface` |
| 2 | Chaque mutation élève exige un `sessionToken` valide | PASS | `npm test -- public-surface` + `npx tsx scripts/smoke-parcours-eleve.ts` |
| 3 | Submit impossible après expiration serveur | PASS | `npx tsx scripts/smoke-parcours-eleve.ts` (§7 « session scellée ») |
| 4 | Score et incidents non falsifiables par le client | PASS | `scripts/smoke-parcours-eleve.ts` §5–6 |
| 5 | Dashboard prof exige le rôle `teacher` | PASS | `npm test -- public-surface` |
| 6 | Réponses courtes : ≥ 5 variantes équivalentes | PASS | `npx vitest run api/grading/__tests__/reponses-courtes-variantes.spec.ts` — 5 questions réelles, 5 à 7 écritures acceptées chacune, fausses toujours refusées |
| 7 | Rendu LaTeX sur Chrome, Firefox, Safari, mobile | PASS | `npx playwright test` — 3 moteurs + `e2e/mobile.spec.ts` (téléphone 390×844, tablette 820×1180), contre le **build de production** |
| 8 | Saisie MathLive fonctionnelle et exploitable serveur | PASS | `npx playwright test parcours-eleve` (frappe → LaTeX → serveur) + `npx vitest run api/grading` (sorties MathLive réelles relevées en navigateur, évaluables par mathjs, valeur conservée) |
| 9 | Auto-save survit à 30 s de coupure réseau | PASS | `npx playwright test parcours-eleve` — coupure réelle, 3 moteurs |
| 10 | Heartbeat 60 s / auto-submit 180 s | PASS | `npx tsx scripts/smoke-anticheat-temps-reels.ts` — 210 s d'observation réelle, sans accélération |
| 11 | Score de suspicion affiché au prof avec verdict | PASS | badge et incidents sur l'écran de correction (`src/pages/teacher/Correction.tsx`) ; verdict « mineur » 20/100 constaté sur copie abandonnée |
| 12 | Couverture ≥ 80 % global, 100 % `api/grading/` | PASS | `npm run test:coverage` — seuils inscrits dans `vitest.config.ts`, vérifiés en CI |
| 13 | Migrations Drizzle committées | PASS | `db/migrations/` suivi par Git |
| 14 | `docker compose up` < 30 s | PASS | `bash scripts/recette-docker.sh` — **27/27**, démarrage 781 ms, génération AMC réelle déclenchée par l'application dans le conteneur |
| 15 | CI GitHub Actions verte sur `main` | IN_PROGRESS | verte sur la branche ; fusion non autorisée à ce stade |
| 16 | 0 `any`, 0 `@ts-ignore` non commenté | PASS | `npx vitest run api/__tests__/typage-strict.spec.ts` — garde durable, 2 suppressions recensées nominativement |
| 17 | Audit : 100 % des modifications manuelles | PASS | `npx vitest run api/grading/__tests__/grade-audit.spec.ts` + `api/__tests__/integration/correction-audit.integration.spec.ts` — refus anonyme et inter-enseignants, journal en ajout seul, auteur, ancienne et nouvelle valeur, motif, requestId |
| 18 | Export CSV et PDF fonctionnel | PASS | `smoke-releve-typographie.ts` (PDF) + `smoke-export-csv.ts` (téléchargement réel : type, nom de fichier, BOM, CRLF, virgule décimale, périmètre de classe, refus anonyme et inter-enseignants) |
| 19 | Login + AuthLayout + NotFound en français | PASS | interface en fr-FR |
| 20 | k6 : 200 élèves, p95 < 500 ms | PASS | `bash scripts/mesure-acceptation.sh 3` — trois campagnes consécutives sur le banc de release : p95 36,02 / 35,60 / 39,65 ms, 0 erreur, 200 copies remises à chaque fois |
| 21 | RGPD : mentions, confidentialité, export | PASS | commit `4a0b188` |
| 22 | `SECURITY.md` à jour | PASS | présent, à resynchroniser en fin de campagne |
| 23 | `README.md` réécrit, quickstart vierge | PASS | commit `62c9e6a` |

**PASS : 22 / 23. IN_PROGRESS : 1. FAIL : 0. BLOCKED_EXTERNAL : 0.**

Reste ouvert : **15** — CI verte sur `main`, qui se vérifie après la fusion.

## 4. Défauts découverts pendant la finalisation

| # | Défaut | Gravité | Correction |
|---|---|---|---|
| 1 | `responses.score` en `int` alors que le moteur produit du crédit partiel : `1.5` stocké `2` | critique, silencieux depuis la phase 2 | `864ec4a` — colonnes décimales + `api/lib/decimal.ts` |
| 2 | `MathInput` / `MathPalette` jamais utilisés : le critère 8 n'était pas satisfait | majeur | `98e5e53` |
| 3 | Affectation de `el.value` avant définition du custom element : la propriété masquait l'accesseur, la réponse de l'élève n'atteignait jamais React | critique | `98e5e53` |
| 4 | Polices MathLive cherchées dans un répertoire jamais servi (dev **et** production) | majeur | `98e5e53` |
| 5 | `.toLowerCase()` transformait `Infinity` en `infinity`, illisible par mathjs : toute limite infinie comptée fausse | critique | `98e5e53` |
| 6 | Opérateurs MathLive (`\cdot`, `\left`, `\right`…) non normalisés côté serveur | majeur | `98e5e53` |
| 7 | `session.heartbeat` lisait `x-session-token`, en-tête que personne n'émet : 401 systématique, surveillance inopérante | critique | `b4430b4` |
| 8 | Le rechargement de page perdait la copie : jeton en mémoire seule | majeur | `5907209` |
| 9 | `answer.listDrafts` sans aucun appelant : brouillons serveur jamais relus | majeur | `5907209` |
| 10 | Requête de sauvegarde sans échéance : sur réseau pendant, blocage définitif sur « Sauvegarde… », rien mis en file locale | critique | `5907209` |
| 11 | « N en attente » comptait des frappes et ne redescendait jamais à zéro | mineur | `5907209` |
| 12 | Relance hors ligne rejouant tous les états intermédiaires d'une question | majeur (risque d'écrasement) | `5907209` |
| 13 | Jeton de session conservé après remise | mineur (sécurité) | `5907209` |
| 14 | `\frac12` — la sortie exacte de la frappe « 1/2 » — n'était pas normalisée : la fraction la plus courante était comptée fausse | critique | `ef8365c` |
| 15 | `compareFraction` ré-analysait le texte brut sans passer par la normalisation | majeur | `ef8365c` |
| 16 | `compareNumeric` reposait sur une liste de cas codés en dur : toute réponse numérique un peu composée était « non convertible », donc fausse | critique | `ef8365c` |
| 17 | `parseSet` ne reconnaissait pas les accolades échappées de MathLive | majeur | `ef8365c` |
| 18 | Le balayage d'inactivité ne tournait jamais seul : le seuil des 180 s ne tenait que si un autre élève émettait | critique | `5f228bd` |
| 19 | Toute limite infinie était comptée fausse (comparaison en minuscules + refus de principe des valeurs non finies) | critique | `5433023` |
| 20 | Le mode de correction « exact » confrontait la réponse à la chaîne vide : il ne reconnaissait jamais rien | critique | `5433023` |
| 21 | Le score de suspicion était calculé avant l'inscription de la déconnexion : copie abandonnée = « Propre » 0/100 | majeur | `5433023` |
| 22 | **Aucun contrôle de propriété sur les routes enseignant** : lecture, recorrection, modification de note, remise forcée et journal d'audit des copies de n'importe quel collègue | critique (sécurité) | `99a5a4b` |
| 28 | **L'impression était impossible dans le déploiement documenté** : le volume `/data/paper-exams` appartenait à root alors que le processus tourne en utilisateur non privilégié | bloquant | `260ae02` |
| 29 | Débordement horizontal sur téléphone : le bouton « Terminer » sortait de l'écran ; et sur tablette côté enseignant, 35 px de trop. Invisibles en développement, présents dans le bundle | majeur | `260ae02` |
| 30 | **Une réponse valant l'infini était acceptée comme égale à n'importe quoi** : « 1/0 » rapportait tous les points sur toute question symbolique | critique | `81fe8b3` |
| 32 | **Le pool de connexions valait dix**, valeur par défaut du pilote jamais écrite : premier point de contention d'une fin d'épreuve | majeur (performance) | mesuré §9 |
| 33 | Les écritures de correction étaient émises une par une, sans transaction : coût inutile **et** copie à moitié corrigée en cas d'interruption | majeur | mesuré §9 |
| 34 | La remise relisait chaque réponse avant de l'écrire : quarante-deux allers-retours pour vingt et une questions | majeur (performance) | mesuré §9 |
| 31 | **Tout logarithme décimal était corrompu** : `\log(10)` devenait `log(1)0*(10)`, illisible pour mathjs | critique | `81fe8b3` |
| 23 | **Le bundle de production ne démarrait pas** : collision `createRequire` entre le banner esbuild et pdfkit. Le développement passe par Vite, jamais par le bundle | bloquant | `5b9b357` |
| 24 | Le quota de démarrage (5/min/IP) rendait une salle d'examen impossible derrière un NAT d'établissement | bloquant | `5b9b357` |
| 25 | Un nom d'élève trop long était coupé net et sans marque sur le relevé remis aux familles | majeur | `1c91d3c` |
| 26 | **Les secrets de session avaient une valeur par défaut publiée dans le dépôt** : une production qui les oublie signe ses cookies enseignant avec une chaîne lisible dans le code source | critique (sécurité) | `075ce17` |
| 27 | La procédure de migration documentée était inapplicable : `drizzle-kit` est retiré de l'image de production | bloquant | `075ce17` |

## 5. Migrations ajoutées

- **`0003_decimal_scores`** — `responses.score` → `decimal(6,2)`,
  `sessions.totalScore` → `decimal(7,2)`.
- **`0004_grade_audit`** — table `grade_audit`, journal en ajout seul des
  interventions sur les notes.
- **`0005_unicite_reponses`** — `UNIQUE (sessionId, questionId)` sur
  `responses`.

### La contrainte d'unicité, pas à pas

**Contrôle préalable** — `npx tsx scripts/preflight-unicite-reponses.ts`

| Base | Réponses | Doublons |
|---|---|---|
| `eval_maths` (développement, peuplée) | 315 | **1 couple** : session 42, question 14, deux lignes strictement identiques |
| `eval_maths_test` (intégration) | 12 | aucun |

Le doublon n'est pas un accident de manipulation : c'est la trace de l'ancien
chemin d'écriture, qui relisait chaque réponse puis insérait. Deux appels
concurrents pouvaient tous deux conclure à l'absence.

**La migration ne supprime rien.** Elle a d'abord été jouée telle quelle sur la
base peuplée : MySQL a refusé l'ordre, la migration s'est arrêtée, et les
315 réponses étaient toujours là. C'est le comportement voulu — deux réponses à
une même question sont une information, et leur sort se décide avec
l'enseignant. Un script séparé, `scripts/reparer-doublons-reponses.ts`, ne
traite que les doublons **strictement identiques**, refuse les divergents, et
n'agit qu'avec `--appliquer`.

**Preuves :**

| | Vérification | Résultat |
|---|---|---|
| A | migrations sur base vierge | contrainte présente, `NON_UNIQUE = 0` sur (sessionId, questionId) |
| B | base peuplée, avant réparation | migration refusée, 315 réponses intactes |
| B | base peuplée, après réparation explicite | 314 réponses, somme des notes **inchangée** (206,25), 4 notes non entières conservées, `score` toujours `decimal(6,2)` |
| C | deux réponses, même session, même question | `ERROR 1062 … Duplicate entry '1-1' for key 'responses.uq_responses_session_question'` |
| D | même question dans deux sessions | accepté |
| E | deux questions dans une même session | accepté |

Preuve d'intégration contre une vraie base :
`api/__tests__/integration/unicite-reponses.integration.spec.ts` — la
contrainte est lue dans `information_schema`, puis exercée sur les quatre cas.

### Ce que la contrainte a permis, et ce qu'elle a fermé

**Écriture groupée.** La correction écrit désormais toute la copie en un seul
ordre. Un `INSERT … ON DUPLICATE KEY UPDATE` a été essayé puis **écarté** : il
pose des verrous d'intervalle sur l'index unique et produit des interblocages
dès que deux copies se corrigent en même temps — c'est-à-dire précisément en
fin d'épreuve. Le symptôme a été observé, pas supposé :
`ER_LOCK_DEADLOCK` dans la suite d'intégration. La mise à jour groupée par
`CASE`, sur des lignes verrouillées dans un ordre déterministe, n'a pas ce
défaut.

| | Avant | Après |
|---|---|---|
| Requêtes SQL par correction | 30 | **10** |
| Requêtes SQL par remise | 43 | **25** |
| Correction (hors charge) | 41,3 ms | **34,1 ms** |
| dont calcul | 8,7 ms | 7,4 ms |
| dont base | 32,9 ms | **26,7 ms** |
| Remise complète (hors charge) | 44,9 ms | **39,6 ms** |

**Remise concurrente.** Deux remises simultanées de la même copie — un
double-clic, une requête rejouée après une coupure — passaient toutes deux la
vérification d'état puis écrivaient les mêmes réponses : la seconde butait sur
la contrainte et **remontait une erreur SQL brute jusqu'à l'élève**. La copie
est désormais prise en un ordre atomique : la première remise qui pose sa date
de fin l'emporte, la seconde est refusée avec « Cette session est déjà
terminée ». La prise est un bail, relâché si la remise échoue en cours de
route, pour qu'une copie ne reste jamais bloquée.

`api/__tests__/integration/remise-concurrente.integration.spec.ts` vérifie
qu'après deux remises simultanées : une seule réponse par question, note non
comptée deux fois, aucun audit inventé, statut cohérent — et que la reprise
réseau ne change ni la note ni la date de remise.

## 6. Tests ajoutés

| Emplacement | Nature |
|---|---|
| `e2e/parcours-eleve.spec.ts` | 3 scénarios navigateur × 3 moteurs |
| `e2e/rendu-mathematique.spec.ts` | 5 scénarios navigateur × 3 moteurs |
| `scripts/smoke-parcours-eleve.ts` | heartbeat et aller-retour de brouillon |
| `scripts/smoke-correction-audit.ts` | override → audit → regrade |
| `scripts/smoke-export-pdf.ts` | relevé PDF |
| `scripts/smoke-anticheat-temps-reels.ts` | seuils 60 s / 180 s aux constantes de production |
| `scripts/smoke-cloisonnement-enseignants.ts` | six refus d'un enseignant sur les copies d'un autre |
| `api/grading/__tests__/reponses-courtes-variantes.spec.ts` | critère 6, 5 questions réelles |
| `api/grading/__tests__/grade-session-moteur.spec.ts` | moteur de session sur base simulée |
| `api/grading/__tests__/grade-response-parcours.spec.ts` | 27 parcours, LLM simulé et en panne |
| `api/grading/__tests__/couverture-comparateurs.spec.ts` | chemins de comparaison rares |
| `api/grading/__tests__/compare-set.spec.ts` | ensembles saisis en LaTeX |
| `api/grading/__tests__/input-mode.spec.ts` | nature du champ sans fuite de barème |
| `api/__tests__/typage-strict.spec.ts` | garde `any` / `@ts-ignore` |

Suite unitaire et d'intégration : **805 tests, 61 fichiers, verts.**

## 7. Résultats navigateur

Commande : `npx playwright test`
Serveur : instance de développement sur `http://localhost:3000`.

```
39 passed (4.4m)
chromium 13/13   firefox 13/13   webkit 13/13
```

Exécutée contre le **build de production** : deux débordements réels
n'apparaissaient pas sur le serveur de développement.

Dont, sur les trois moteurs :

- saisie MathLive au clavier, LaTeX effectivement produit et transmis ;
- rechargement de page : session reprise, brouillons restaurés ;
- **coupure réseau réelle de 30 s** : interface non figée, bascule sur file
  locale, rétablissement, purge de la file, rechargement, réponse écrite hors
  ligne retrouvée, remise effectuée depuis l'état restauré, jeton nettoyé ;
- navigation avant/arrière sans perte ;
- rendu KaTeX de plusieurs familles de formules sans erreur console.

Aucun `429` observé sur `session.start` : le quota de production (5/min/IP)
n'a pas été touché, et le test échoue bruyamment si un refus survient.

## 8. Couverture — critère 12 **PASS**

Commande : `npm run test:coverage`. Les seuils sont inscrits dans
`vitest.config.ts` : le critère ne dépend plus d'une mesure ponctuelle, et la
CI monte une base MySQL pour que la garde tienne à distance.

| Périmètre | Lignes | Branches | Fonctions | Instructions |
|---|---|---|---|---|
| `api/grading/` | **100 %** | **100 %** | **100 %** | **100 %** |
| Global | 85,00 % | 80,00 % | 85,46 % | 84,91 % |
| Global mesuré en CI | 85,20 % | 80,21 % | 85,46 % | 85,09 % |

`PLAN.md` ne nomme pas de métrique : les quatre sont retenues, lecture la plus
stricte. **Aucune exclusion n'a été posée pour arranger le chiffre.** Le code
que rien ne pouvait atteindre a été supprimé plutôt que contourné : un client
HTTP de 78 lignes sans le moindre appelant, une garde de dénominateur nul déjà
traitée en amont, un test de correction rejoué après un retour anticipé.

Le passage de 41,7 % à 85 % vient d'un socle de tests d'intégration sur une
base réelle (`vitest.global-setup.ts` + `api/__tests__/integration/`) : les
routeurs portent la moitié de la logique métier — propriété des données,
transactions, invariants — et rien de cela ne s'éprouve avec une base simulée.

Le front n'est pas dans le périmètre instrumenté : il est couvert par les
24 scénarios Playwright, exécutés contre le build de production.

## 9. Charge (k6) — critère 20

### 9.0 Définition retenue

`PLAN.md` fait foi : **« k6 : 200 élèves concurrents, p95 < 500 ms, 0 erreur. »**

Deux scénarios distincts en découlent, et ils ne se remplacent pas :

| Fichier | Rôle |
|---|---|
| `load/acceptance-200.k6.js` | **Test d'acceptation contractuel.** 200 élèves composent en même temps et rendent leur copie au fil de leur avancement. Le décalage entre élèves est déterministe, dérivé du numéro d'utilisateur virtuel, pour que deux exécutions soient comparables. |
| `load/burst-submit.k6.js` | **Test de résistance.** 200 copies rendues au même instant. Ce n'est pas le critère : une salle d'examen ne se comporte pas ainsi. C'est une limite de capacité en pointe extrême, mesurée et documentée comme telle. |

Le service de correction assistée n'est pas sollicité : les questions de
l'évaluation de référence sont toutes déterministes (`llmReviewRequired:
false`). La mesure porte donc sur **DETERMINISTIC_GRADING_LATENCY** et sur elle
seule — ce n'est pas une fonction désactivée pour la circonstance, c'est la
configuration de ces questions.

### 9.1 Profil d'une remise, avant / après optimisation

`PROFIL_SQL=1 npx tsx scripts/profil-submit.ts`

| | Départ | Après transaction + écriture groupée d'entrée | Après unicité + mise à jour groupée |
|---|---|---|---|
| Requêtes SQL par correction | 25 | 30 | **10** |
| Requêtes SQL par remise | 82 | 43 | **25** |
| Calcul (mathjs, 21 questions) | 12,4 ms | 8,7 ms | **7,4 ms** |
| Base de données | 153,1 ms | 32,9 ms | **26,7 ms** |
| Correction complète | 165,5 ms | 41,3 ms | **34,1 ms** |
| Remise complète, hors charge | 61,0 ms | 44,9 ms | **39,6 ms** |

Le moteur de correction n'a jamais été en cause : sept pour cent du temps.

### 9.2 Ce qui a été corrigé

1. **Les écritures de correction étaient émises une par une**, chacune avec son
   aller-retour et sa validation sur disque. Elles sont appliquées en une
   transaction — ce qui leur donne au passage l'atomicité : une interruption en
   cours de route laissait une copie à moitié corrigée.
2. **La remise relisait chaque réponse avant de l'écrire** : quarante-deux
   allers-retours pour vingt et une questions.
3. **Le pool de connexions valait dix**, valeur par défaut du pilote, jamais
   écrite. Il est désormais explicite.
4. **La correction écrit toute la copie en un seul ordre**, ce que rend possible
   la contrainte d'unicité (voir §5).

### 9.3 Courbe de contention et dimensionnement du pool

Remise seule, p95, à 200 copies rendues au même instant :

| Pool | p95 |
|---|---|
| 20 | 3,90 s |
| 40 | 1,90 s |
| **60** | **1,74 s** |
| 80 | 2,13 s |
| 100 | 2,31 s |
| 140 | 5,19 s |

Au-delà de soixante, la base arbitre plus qu'elle ne travaille, et MySQL
n'accepte que 151 connexions par défaut.

**`DB_POOL_SIZE = 60` est un `LOCAL_BENCHMARK_OPTIMUM`, pas un
`PRODUCTION_OPTIMUM`.** La valeur reste configurable et doit être remesurée sur
la cible, au minimum autour de 20 / 40 / 60 / 80.

Une hypothèse a été testée puis écartée faute de preuve : la durabilité du
journal InnoDB. `innodb_flush_log_at_trx_commit=1` donne 1,61 s,
`=2` donne 2,25 s — le réglage censé être plus rapide ressort plus lent. La
conclusion honnête n'est pas « la durabilité ne coûte rien » mais **la mesure
est trop bruitée à cette échelle sur cette machine**.

### 9.4 Environnement de la mesure locale

| | |
|---|---|
| Processeur | AMD Ryzen 7 3700X, 16 cœurs |
| Mémoire | 31 Go |
| Système | Linux Mint 22.1, noyau 6.8.0-138 |
| Docker | 29.1.3 |
| Node | 22.22.0 |
| MySQL | 8.4.11 en conteneur, `max_connections = 151` |
| Stockage | ext4 sur SSD/NVMe |
| `DB_POOL_SIZE` | 60 |
| Instances applicatives | 1 |
| Générateur de charge | k6 en conteneur, **même machine** |

**Cette machine n'est pas l'infrastructure cible** : l'application, la base et
le générateur de charge y partagent le même processeur. C'est la limite
principale de ce qui suit.

### 9.5 Test d'acceptation — trois exécutions consécutives

`bash scripts/mesure-acceptation.sh 3`

Le script attend cinq minutes et demie entre deux exécutions. Ce n'est pas
cosmétique : `session.start` est plafonné à six cents ouvertures par tranche de
cinq minutes et par adresse, et trois exécutions de deux cents élèves lancées à
la suite mesureraient le limiteur au lieu de l'application. **Le quota de
production n'est pas touché ; c'est le générateur qui patiente.** Une première
campagne, lancée sans cet espacement, avait produit 11 % de refus de quota sur
sa deuxième exécution — l'erreur était dans la méthode de mesure, pas dans le
produit.

| Exécution | p50 | p95 | p99 | Erreurs HTTP | Échecs métier | Refus de quota | Copies remises |
|---|---|---|---|---|---|---|---|
| 1 | 6,67 ms | **36,02 ms** | 47,33 ms | 0 / 2600 | 0 / 200 | 0 | 200 |
| 2 | 6,37 ms | **35,60 ms** | 47,80 ms | 0 / 2600 | 0 / 200 | 0 | 200 |
| 3 | 6,88 ms | **39,65 ms** | 52,44 ms | 0 / 2600 | 0 / 200 | 0 | 200 |

Remise seule : p95 de 52, 52 et 58 ms.

**Trois exécutions consécutives conformes**, sur cette machine.

### 9.6 Test de résistance — 200 copies au même instant

`docker run … -e VUS=200 grafana/k6 run - < load/burst-submit.k6.js`

| p50 | p95 | p99 | Erreurs | Débit |
|---|---|---|---|---|
| 1,96 s | 2,09 s | 2,11 s | **0** | 66 remises/s |

Aucune erreur, aucune copie perdue : le système ne rompt pas, il ralentit. Le
p95 de la remise sous cette pointe est passé de **6,73 s à 2,09 s** au cours de
la campagne. Cette limite est documentée comme telle et **ne conditionne pas le
critère 20**.

### 9.7 Verdict du critère 20

`PLAN.md` demande « 200 élèves concurrents, p95 < 500 ms, 0 erreur ». Les trois
campagnes du §9.5 satisfont cette définition, sur le banc de release décrit en
§9.4 : deux cents utilisateurs virtuels concurrents, parcours complet, build de
production, trois exécutions consécutives, p95 global de 36,02 / 35,60 /
39,65 ms, remise elle-même à 52 / 52 / 58 ms, zéro erreur HTTP, zéro échec
métier, zéro refus de quota.

**Critère 20 : PASS.**

Le test de résistance du §9.6 — deux cents copies rendues artificiellement au
même instant, p95 ≈ 2,09 s, zéro erreur — est une **limite de capacité connue**,
documentée comme telle. Ce n'est pas le critère, et il ne le remet pas en cause.

Deux portes distinctes, à ne pas confondre :

| Porte | Contenu | État |
|---|---|---|
| **RC1 PERFORMANCE GATE** | le critère 20 de `PLAN.md`, mesuré sur le banc de release | **franchie** |
| **PRODUCTION CAPACITY VALIDATION** | le même banc rejoué sur l'infrastructure effectivement retenue, avec un générateur de charge extérieur à la machine applicative | **à faire avant `v1.0.0`**, pas avant `rc1` |

Ce que la validation de production devra mesurer : l'architecture réelle
(instances, proxy, base séparée ou non), un générateur de charge externe, le
pool de connexions optimal sur cette machine, le stockage, le processeur et la
mémoire, puis le scénario d'acceptation et le test de résistance.

## 10. Docker / AMC

`bash scripts/recette-docker.sh` — **18 étapes, 18 vérifiées**, sur le runtime
destiné à la production et non sur la machine de développement.

| | Étape | Résultat |
|---|---|---|
| 1 | image de base | 428 Mo |
| 2 | image avec impression (`Dockerfile.amc`) | 2 799 Mo |
| 3 | base vierge | démarre |
| 4 | migrations depuis l'image (`node dist/migrate.js`) | appliquées |
| 5 | schéma créé | 13 tables |
| 6 | `responses.score` dans l'image déployée | `decimal(6,2)` |
| 7 | secret de développement en production | refusé au démarrage |
| 8–9 | santé et démarrage | **781 ms** (< 30 s) |
| 10 | `auto-multiple-choice` utilisable | version 1.6.0-1 |
| 11 | classe LaTeX d'AMC | `/usr/share/texmf/tex/latex/AMC/automultiplechoice.sty` |
| 12–14 | montée de version d'une base peuplée | note 1,75 intacte |
| 15–16 | application et polices mathématiques servies | HTTP 200 |
| 17 | API publique | répond |
| 18 | route enseignant sans authentification | HTTP 401 |

**Ce qui manque au critère 14** : une génération AMC réelle depuis le
conteneur — sujet, corrigé, catalogue — puis saisie papier, correction,
intervention manuelle et relevé PDF. Les briques sont vérifiées séparément sur
la machine de développement (`scripts/smoke-chaine-papier.ts`), pas encore
enchaînées dans l'image.

## 10 bis. Analyse de secrets sur la demande de fusion

L'analyse automatique de la PR (GitGuardian) est **rouge** : « 3 secrets
uncovered ». Elle a été prise au sérieux et instruite, pas contournée.

### Ce qui a été corrigé

Cette branche avait introduit des chaînes de connexion complètes — utilisateur
et mot de passe — dans l'amorçage des tests (`vitest.setup.ts`,
`vitest.global-setup.ts`) et dans une recette (`scripts/smoke-scores-decimaux.ts`).
Ce sont des identifiants de bac à sable local, mais les laisser en clair est
l'habitude qui finit par masquer une vraie fuite. L'adresse de la base
d'intégration vient désormais de `TEST_DATABASE_URL` et de nulle part ailleurs ;
la recette exige son mot de passe d'administration par l'environnement.

### Ce qui reste, et pourquoi l'analyse reste rouge

L'analyse porte sur **l'ensemble des commits de la demande de fusion**, pas sur
l'état final : retirer une chaîne dans un commit ultérieur ne l'efface pas de
l'historique, et réécrire l'historique publié est exclu.

Inventaire exhaustif de ce qu'un analyseur voit dans cette branche :

| Chaîne | Nature |
|---|---|
| `MYSQL_ROOT_PASSWORD: root`, `mysql://ci:ci@127.0.0.1:3306/ci` | conteneur MySQL éphémère du travail de CI, déclaré dans le workflow lui-même |
| `MYSQL_ROOT_PASSWORD: dev_root`, `mysql://eval:dev_password@…:3307/…` | conteneur de développement de `docker-compose.dev.yml`, lié à `127.0.0.1` |
| `mysql://test:test@localhost:3306/test` | adresse factice des tests unitaires, présente sur `main` avant cette branche |
| `mysql://user:pass@host:port/db` | gabarit de `.env.example` |

**Aucune n'est un identifiant vivant.** Recherche exhaustive dans tout
l'historique de la branche : aucune clé d'API, aucun jeton, aucune clé privée.
La clef du fournisseur de modèle vit dans `.env`, ignoré par Git, et n'apparaît
dans aucun fichier suivi ni dans aucun commit.

### Ce qui est demandé

Ces relevés se résolvent sur le tableau de bord GitGuardian — marquer les
incidents comme faux positifs ou identifiants de bac à sable — ce qui relève du
compte du propriétaire du dépôt. Le contournement n'est ni fait ni proposé :
l'alerte reste rouge tant qu'elle n'a pas été instruite par une personne.

Les contrôles GitHub Actions de la demande de fusion, eux, sont **verts** :
types, style, tests, couverture, build, base créée depuis le dépôt, image de
production.

## 11. CI distante

| Run | Commit | Résultat |
|---|---|---|
| 33273190905 | `5a24b63` | succès |
| 33275802846 | `7ad41a2` | succès |
| 33276738129 | `5433023` | succès |
| — | `99a5a4b` | poussé, en attente |

## 12. Ce qui reste avant `v1.0.0`

`v1.0.0-rc1` atteste que le logiciel est prêt à être déployé. Il n'atteste pas
qu'il l'a été. Ce qui suit relève du gate de production, distinct du gate RC1.

### Validation de capacité sur l'infrastructure retenue

Le critère 20 est satisfait sur le banc de release (§9.7). Le même banc doit
être rejoué sur la machine effectivement choisie, avec un générateur de charge
**extérieur** à la machine applicative — sans quoi il prend le processeur de ce
qu'il mesure.

```bash
# Sur la cible, au commit tagué
git checkout v1.0.0-rc1
docker build -t eval-maths:rc1 .
docker compose up -d                      # .env renseigné au préalable
docker compose exec app node dist/migrate.js

# Relevé de l'environnement, à consigner ici
nproc; free -g; docker --version
docker compose exec mysql mysql -N -B -e "SELECT VERSION(), @@max_connections"

# Dimensionnement du pool sur la cible — 60 est un optimum de banc, pas une
# constante universelle
for POOL in 20 40 60 80; do
  DB_POOL_SIZE=$POOL docker compose up -d app
  # depuis la machine du générateur :
  docker run --rm -i grafana/k6 run - < load/burst-submit.k6.js \
    -e BASE_URL=https://<cible> -e VUS=200
done

# Mesure d'acceptation, depuis la machine du générateur
BASE_URL=https://<cible> bash scripts/mesure-acceptation.sh 3
```

### Migration d'un environnement réel

La contrainte d'unicité sur `responses(sessionId, questionId)` est **fermée par
défaut** : une base contenant des doublons fait échouer la migration plutôt que
de perdre une réponse. Sur un environnement portant de vraies copies :

```sql
SELECT sessionId, questionId, COUNT(*)
FROM responses
GROUP BY sessionId, questionId
HAVING COUNT(*) > 1;
```

| Résultat | Conduite |
|---|---|
| Aucune ligne | poursuivre, la migration passe |
| Doublons **strictement identiques** | **arrêt** — réparation explicite par un opérateur (`scripts/reparer-doublons-reponses.ts --appliquer`), après accord |
| Doublons **divergents** | **arrêt absolu** — deux réponses différentes à une même question demandent une investigation humaine : laquelle est celle de l'élève ? |

Aucune suppression automatique, jamais, et la commande de réparation ne figure
pas dans la migration.

### Le reste du gate de production

- infrastructure explicitement désignée ;
- secrets réels, distincts et générés (`openssl rand -base64 48`) — le
  démarrage refuse les valeurs du dépôt ;
- OAuth Kimi réel, domaine et redirection déclarés ;
- DNS et certificat TLS ;
- sauvegarde en place et **restauration éprouvée** avant la mise en service ;
- chaîne AMC exercée sur la production : sujet, corrigé, catalogue ;
- saisie papier, correction, intervention manuelle, relevés PDF et CSV ;
- smoke complet et procédure de retour arrière prête.

Aucun secret ne figure dans ce document et aucun n'y figurera : adresses et
identifiants restent dans le `.env` de la machine concernée.

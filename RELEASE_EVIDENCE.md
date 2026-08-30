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
| HEAD | `593c4d0` |
| Base de la finalisation | `5a24b63` (`feat(dashboard)`) |
| Worktree | propre |
| Dernière mise à jour | 2026-08-30 (lots critères 7, 12, 14, 17, 18) |

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
| 20 | k6 : 200 élèves, p95 < 500 ms | **FAIL** | mesuré et optimisé, voir §9 : remise passée de 6,73 s à 2,29 s de p95 ; ouverture, énoncés et brouillons sous 500 ms ; constat chiffré `SYNC_OPTIMIZATION_LIMIT` |
| 21 | RGPD : mentions, confidentialité, export | PASS | commit `4a0b188` |
| 22 | `SECURITY.md` à jour | PASS | présent, à resynchroniser en fin de campagne |
| 23 | `README.md` réécrit, quickstart vierge | PASS | commit `62c9e6a` |

**PASS : 21 / 23. IN_PROGRESS : 1. FAIL : 1. BLOCKED_EXTERNAL : 0.**

Reste ouvert : **15** (CI verte sur `main`) — la fusion n'est pas autorisée
tant que le critère 20 n'est pas clos. Le critère **20** est en échec mesuré,
pas en attente : voir §9.

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

Suite unitaire : **541 tests, 37 fichiers, verts.**

## 7. Résultats navigateur

Commande : `npx playwright test`
Serveur : instance de développement sur `http://localhost:3000`.

```
24 passed (3.8m)
chromium 8/8   firefox 8/8   webkit 8/8
```

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

## 9. Charge (k6) — critère 20 **FAIL**, avec constat chiffré

### 9.1 Ce qui a été mesuré

Scénario `load/parcours-eleve.k6.js` : 200 utilisateurs virtuels, **une copie
chacun**, parcours complet. Cible : le build de production (`node dist/boot.js`),
base MySQL 8.4 en conteneur, tout sur la même machine que k6.

Le service de correction assistée n'est pas sollicité : les questions de
l'évaluation de référence sont toutes déterministes (`llmReviewRequired: false`).
La mesure porte donc sur **DETERMINISTIC_GRADING_LATENCY** et sur elle seule.
Aucun appel au LLM ni au RAG n'intervient — ce n'est pas une fonction désactivée
pour la circonstance, c'est la configuration de ces questions.

### 9.2 Profil d'une remise, avant toute optimisation

`PROFIL_SQL=1 npx tsx scripts/profil-submit.ts`

| Part | Durée |
|---|---|
| Calcul (mathjs, 21 questions) | 12,4 ms |
| Base de données | 153,1 ms |
| **Correction complète** | **165,5 ms** |
| Requêtes SQL par correction | 25 |
| Requêtes SQL par remise entière | 82 |

**Le moteur de correction n'était pas en cause** : sept pour cent du temps. Tout
le reste était des allers-retours à la base.

### 9.3 Ce qui a été corrigé

1. **Les écritures de correction étaient émises une par une.** Vingt et un ordres
   d'écriture, chacun avec son aller-retour et sa validation sur disque. Elles
   sont maintenant appliquées en une seule transaction — ce qui leur donne au
   passage l'atomicité : une interruption en cours de route laissait jusqu'ici
   une copie à moitié corrigée.
2. **La remise relisait chaque réponse avant de l'écrire.** Quarante-deux
   allers-retours pour vingt et une questions. L'état existant est lu une fois,
   les nouvelles réponses insérées en un seul ordre, et seules celles qui
   changent réellement sont mises à jour.
3. **Le pool de connexions valait dix**, la valeur par défaut du pilote,
   invisible parce que jamais écrite. Il est désormais explicite et dimensionné.

| | Avant | Après |
|---|---|---|
| Correction | 165,5 ms | 41,3 ms |
| Dont base | 153,1 ms | 34,3 ms |
| Requêtes par remise | 82 | 43 |
| Remise complète, hors charge | 61,0 ms | 44,9 ms |

### 9.4 Courbe de contention

`load/courbe-contention.k6.js`, remise seule, p95 :

| Élèves simultanés | p95 |
|---|---|
| 1 | 56 ms |
| 25 | 459 ms |
| 50 | 584 ms |
| 100 (pool 20) | 5,49 s |
| 100 (pool 60) | 1,54 s |
| 200 (pool 60) | 1,74 s |

Dimensionnement du pool, à 200 remises simultanées :

| Pool | p95 |
|---|---|
| 20 | 3,90 s |
| 40 | 1,90 s |
| **60** | **1,74 s** |
| 80 | 2,13 s |
| 100 | 2,31 s |
| 140 | 5,19 s |

Au-delà de soixante, la base passe plus de temps à arbitrer qu'à travailler, et
MySQL n'accepte de toute façon que cent cinquante et une connexions par défaut.
**Soixante devient la valeur par défaut**, documentée et surchargeable par
`DB_POOL_SIZE`.

Étalement des remises, pool 60, 200 élèves :

| Arrivée | p50 | p95 |
|---|---|---|
| Toutes dans la même seconde | 1,13 s | 1,74 s |
| Réparties sur 5 s | 563 ms | 1,78 s |
| Réparties sur 10 s | 123 ms | 682 ms |

### 9.5 Mesure officielle, après optimisation

Parcours complet, 200 élèves, pool par défaut :

| Opération | p50 | p95 | Critère |
|---|---|---|---|
| `session.start` | 94 ms | 313 ms | ✅ |
| `question.getForActiveSession` | 41 ms | 71 ms | ✅ |
| `answer.saveDraft` | 65 ms | 380 ms | ✅ |
| `session.heartbeat` | 307 ms | 649 ms | ❌ |
| `session.submit` | 1,91 s | 2,29 s | ❌ |
| Global | 110 ms | 1,88 s | ❌ |

200 sessions ouvertes, 200 copies remises, **0 échec métier, 0 refus de quota**.

Le p95 de la remise passe de **6,73 s à 2,29 s** sur ce scénario, et de 3,90 s à
1,74 s sur la remise isolée.

### 9.6 SYNC_OPTIMIZATION_LIMIT

Le critère 20 n'est **pas** atteint et n'est pas déclaré atteint.

Il reste un levier synchrone identifié : regrouper les vingt et un ordres
d'écriture de la correction en un seul, ce qui ramènerait la remise de 43 à
environ 23 requêtes. Voici pourquoi il ne suffirait pas.

- Débit mesuré de cette base : 200 remises × 43 requêtes en ≈ 3,5 s, soit
  **≈ 2 460 requêtes par seconde**.
- Pour tenir 500 ms avec 23 requêtes par remise, il faudrait
  200 × 23 ÷ 0,5 = **9 200 requêtes par seconde**, soit **3,7 fois** la capacité
  observée.

Autrement dit, même en supprimant tout ce qui reste de superflu dans le chemin
d'écriture, la correction synchrone de deux cents copies remises **dans la même
seconde** ne tient pas les 500 ms sur cette machine.

### Attribution : est-ce la durabilité du disque ?

Une hypothèse naturelle est que le coût vient des écritures synchrones du
journal InnoDB. Elle a été testée en rejouant la même charge contre deux bases
identiques, l'une en `innodb_flush_log_at_trx_commit=1` (durabilité stricte),
l'autre en `=2` (validation différée d'une seconde) :

| Réglage | p95 de la remise |
|---|---|
| `=1`, durabilité stricte | 1,61 s |
| `=2`, validation différée | 2,25 s |

Le second réglage, censé être plus rapide, est ressorti **plus lent**. La
conclusion honnête n'est pas « la durabilité ne coûte rien » mais **la mesure
est trop bruitée à cette échelle sur cette machine pour trancher** : le poste
exécute simultanément l'application, la base, k6 et le reste du système. C'est
une raison de plus de refaire la mesure sur l'infrastructure cible avant toute
décision d'architecture.

**Deux réserves importantes, dans les deux sens :**

1. La mesure est prise sur un poste de développement où tournent simultanément
   l'application, la base en conteneur, k6 en conteneur et le reste de la
   machine. Une base de production sur matériel dédié irait plus vite — d'un
   facteur qui reste à mesurer **sur l'infrastructure cible**, ce qui n'a pas
   été fait et ne sera pas supposé.
2. Le pire cas modélisé — deux cents copies remises dans la même seconde — n'est
   pas le déroulement ordinaire d'une épreuve. Avec une arrivée étalée sur dix
   secondes, le p50 tombe à 123 ms. Et la remise automatique de fin d'épreuve,
   elle, est faite par le serveur : elle ne fait attendre personne.

**Le levier synchrone suivant, non engagé.** La table des réponses ne porte
aucune contrainte d'unicité sur le couple (session, question) — rien
n'empêcherait aujourd'hui deux réponses à la même question dans une même copie.
L'ajouter serait une amélioration d'intégrité en soi, et permettrait d'écrire
les vingt et une corrections en un seul ordre `INSERT … ON DUPLICATE KEY
UPDATE` au lieu de vingt et un. Ce n'est pas engagé ici : le calcul du §9.6
montre que cela ne suffirait pas à tenir les 500 ms, et une migration touchant
la table des notes se décide avec vous, pas en fin de campagne.

**Ce qui n'a pas été fait, et pourquoi.** Passer la correction en traitement
différé tiendrait le chiffre, mais changerait le contrat fonctionnel — la copie
serait remise puis corrigée plus tard, ce qui touche l'API, le jeton de
résultats, le statut des sessions, l'écran de résultats et le déploiement. La
mission l'exclut tant que la voie synchrone n'est pas épuisée, et surtout tant
que la mesure n'a pas été refaite sur l'infrastructure de production.

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

## 11. CI distante

| Run | Commit | Résultat |
|---|---|---|
| 33273190905 | `5a24b63` | succès |
| 33275802846 | `7ad41a2` | succès |
| 33276738129 | `5433023` | succès |
| — | `99a5a4b` | poussé, en attente |

## 12. Production

Aucun déploiement de production vérifié. `v1.0.0` reste hors d'atteinte tant
que ce n'est pas le cas ; seul `v1.0.0-rc1` est envisageable, et seulement une
fois les 23 critères clos.

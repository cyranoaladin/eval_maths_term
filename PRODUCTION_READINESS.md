# Matrice de mise en production

Ce document est le registre du gate **v1.0.0-rc2 puis v1.0.0**. Il est distinct
des 23 critères historiques de `PLAN.md`, qui restent vrais et ne sont pas
réécrits : `v1.0.0-rc1` est un jalon acquis et immuable.

`GO_RC1` ne vaut pas `GO_LIVE`. Ce qui suit vise un produit sans dette connue
sur le chemin fonctionnel.

**Règle** : un `PASS` exige une preuve exécutée, avec la commande qui l'établit.
États : `PASS` · `FAIL` · `IN_PROGRESS` · `BLOCKED_EXTERNAL`.

---

## 1. Position

| | |
|---|---|
| Branche | `release/production-hardening` |
| Base | `90fb380` (`main`, tag `v1.0.0-rc1`) |
| Dernière mise à jour | 2026-08-31 — matrice corrigée après revue indépendante |
| `v1.0.0-rc2` | **n'existe pas**, et ne doit pas être posé |
| Verdict | `NO_GO_RC2` |

---

## 1 bis. Périmètre de la version candidate

```
RC2_PAPER_WORKFLOW               generate → print → manual entry → grading
OPTICAL_CAPTURE                  NOT IMPLEMENTED IN RC2 WEB APP
INTEGRATED_OPTICAL_SCAN_RC2      OUT_OF_SCOPE
OPTICAL_SCAN_FUTURE_CAPABILITY   PRESERVED
```

`v1.0.0-rc2` décrit le produit réellement implémenté. La lecture optique des
copies reste une capacité d'`auto-multiple-choice` et une évolution possible,
dans un service séparé ; elle n'est pas intégrée, et le runtime ne porte pas ce
qu'il faudrait pour elle. Voir `docs/ADR-OPTICAL-CORRECTION-BOUNDARY.md`.

---

## 2. Audit initial — l'état réel avant toute modification

Mesuré, pas estimé. C'est la ligne de départ.

### 2.1 Volumétrie

| | |
|---|---|
| Fichiers source (`.ts`/`.tsx`) | 258 |
| Lignes | 36 683 |
| Procédures tRPC | 52 |
| Routes HTTP hors tRPC | 4 servies (`/api/oauth/login`, callback, `/api/health`, `/api/paper/:examId/:file`) + filet 404 |
| Tables | 13 |
| Migrations | 6 |
| Clés étrangères | 20 |
| Contraintes uniques | 3 |
| Index | 49 |
| Dépendances | 67 production, 27 développement |

### 2.2 Dette — état de départ

| Marqueur | Compte | Détail |
|---|---|---|
| `TODO` / `FIXME` / `HACK` | **0** | — |
| `DEPRECATED` | **1** | `sessions.cheatEvents` — colonne JSON, « drop prévu en v0.4.0 » |
| `@ts-ignore` | **0** | (les occurrences trouvées sont dans la garde qui les cherche) |
| `@ts-expect-error` | **2** | `MathInput.tsx:204` (web component), `cheat-immutability.spec.ts:55` (type invalide voulu) |
| `eslint-disable` | **2** | `MathInput.tsx:32` (namespace JSX), `DevToolsDetector.tsx:51` (`no-debugger`) |
| `coverage-ignore` | **0** | — |
| Tests `skip`/`only`/`fixme`/`todo` | **0** | — |
| `console.*` hors logger | **16** | `boot.ts`, `kimi/auth.ts`, `kimi/platform.ts`, 5 dans `src/`, 6 dans les scripts CLI |
| Cycles de dépendances | **0** | `madge --circular` |

### 2.3 Code mort (knip, périmètres d'entrée déclarés)

| | Compte |
|---|---|
| Fichiers inutilisés | **39** — 37 composants `ui/` jamais importés, `MathPalette.tsx`, `api/__tests__/setup.ts` |
| Dépendances de production inutilisées | **30** — dont `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `recharts`, 16 primitives Radix |
| Dépendances de développement inutilisées | **2** |
| Exports inutilisés | 55 |
| Types exportés inutilisés | 72 |

### 2.4 Routes sans appelant d'interface

Huit procédures ne sont appelées par aucun écran :

| Route | Appelants |
|---|---|
| `answer.getSaved` | test seul |
| `evaluation.listForTeacher` | test seul |
| `evaluation.seed` | test seul |
| `grading2.getResults` | recette + test |
| `question.getWithAnswersForTeacher` | test seul |
| `session.getAllForTeacher` | recette + test |
| `cheat.report` | test seul — remplacée par `cheat.reportBatch` |
| `ping` | test seul |

### 2.5 Duplication de logique métier (jscpd)

0,7 % de lignes dupliquées au total. Ce qui relève du métier :

| Emplacements | Nature |
|---|---|
| `answer-router.ts:28` ≡ `:144` | contrôle de session répété entre `save` et `saveDraft` |
| `answer-router.ts:42` ≡ `session-router.ts:42` | **deux sources de vérité** sur « cette copie est-elle inscriptible ? » |
| `grading-router.ts:76` ≡ `session-router.ts:523` | mise en forme des résultats en double |
| `results-pdf.ts:79/130` ≡ `paper-router.ts:389/575` | **deux calculs du même relevé** |
| `authoring-router.ts:136` ≡ `:260`, `:437` ≡ `:473` | contrôle de propriété et mise en forme répétés |
| `paper-router.ts:168` ≡ `:192`, `:331` ≡ `:531`, `:388` ≡ `:544` | idem |

### 2.6 Dépendances vulnérables

`npm audit --omit=dev` : **0 critique, 5 élevées**, toutes corrigeables.

| Paquet | Portée |
|---|---|
| **`mathjs`** | modification incontrôlée d'attributs d'objet (CWE-915). **Le plus grave ici : nous évaluons des expressions fournies par les élèves.** |
| `hono` | injection d'en-tête `Set-Cookie`, contournement de restriction IP |
| `react-router` | redirection ouverte, XSS |
| `nanoid` | boucle infinie sur taille négative |
| `lodash` | injection de code, pollution de prototype — transitive via `recharts`, lui-même inutilisé |

### 2.7 Points bloquants identifiés à la revue

| | Sujet |
|---|---|
| **Provisionnement** | `users.role` a `teacher` par défaut : un compte OAuth inconnu devient enseignant sans approbation |
| **OAuth** | l'URL de redirection est construite depuis l'en-tête `Host` de la requête |
| **Image** | `docker-compose.yml` construit une image **sans AMC** : un `docker compose up -d` « de production » démarre une application incapable d'imprimer |
| **Configuration** | `env.ts` retient Moonshot par défaut, `docker-compose.yml` retient OpenRouter : deux comportements selon la méthode de démarrage |
| **Identité** | `package.json` annonce `my-app@0.0.0` |
| **CI** | les tests navigateur existent mais ne sont pas exécutés par la CI |
| **`main`** | non protégée |

---

## 3. Matrice du gate

| # | Exigence | État | Preuve |
|---|---|---|---|
| P1 | 0 suppression de type, 0 suppression de linter, 0 test ignoré | **PASS** | `api/__tests__/typage-strict.spec.ts` — balaie 200+ fichiers, interdit les six formes d'exception et les tests ignorés |
| P2 | 0 identifiant codé en dur, 0 secret de développement versionné | **PASS** | `contrat-env.spec.ts` « ne versionne aucun identifiant en clair » ; `scripts/bootstrap-dev.sh` ; identifiants éphémères en CI |
| P3 | Une seule source de configuration, parité prouvée | **PASS** | `api/__tests__/config/contrat-env.spec.ts` — 8 vérifications sur `env.ts`, `.env.example`, les deux composes et `DEPLOYMENT.md` |
| P4 | Identité produit et version exposées, SHA injecté au build | **PASS** | `atelier-qcm@1.0.0-rc2` ; `/api/health` → `{"version":"1.0.0-rc2","gitSha":"…"}` sur le binaire construit |
| P5 | 0 double source de vérité (`correctAnswer` / `gradingRubric`) | **PASS** | `api/authoring/__tests__/coherence-bareme.spec.ts` ; `scripts/audit-coherence-questions.ts` sur la base réelle |
| P6 | 0 dette anti-triche | **PASS** | migration 0007 + `migration-incidents.integration.spec.ts` ; une seule route d'ingestion |
| P7 | 0 route orpheline | **PASS** | 52 → 45 procédures ; `public-surface.spec.ts` fige l'inventaire |
| P8 | Invariants d'intégrité des 13 tables, contraintes en base | **PASS** | migration 0009 + `preflight-invariants.ts` ; `invariants-base.integration.spec.ts` écrit en base sans passer par l'application — voir §6 |
| P9 | Provisionnement enseignant explicite, aucun accès automatique | **PASS** | migration 0006 + `acces-comptes.integration.spec.ts` (11 cas sur la vraie base) |
| P10 | OAuth durci — `PUBLIC_BASE_URL`, cookie `Secure`, validation du jeton | **PASS** | `api/__tests__/security/oauth-durcissement.spec.ts` — 18 cas |
| P11 | En-têtes de sécurité HTTP, CSP sans `unsafe-eval` | **PASS** | `surface-http.integration.spec.ts` sur du vrai HTTP + 39 parcours sur le build de production, trois moteurs |
| P12 | Analyse de secrets dans notre CI | **PASS** | job `Sécurité` : gitleaks sur tout l'historique, `--exit-code 1` ; 6 empreintes historiques exactes dans `.gitleaksignore`, aucune règle désactivée, aucun chemin exclu, aucune wildcard |
| P13 | Chaîne d'approvisionnement — 0 vulnérabilité HIGH/CRITICAL, SBOM | **FAIL** | le runtime a été réduit par la mesure : 443 → 179 paquets, 3 307 → 988 Mo, 32 → 14 CRITICAL, 139 → 48 HIGH. Il reste 26 CVE distinctes, toutes sans correctif amont, dont 13 déjà présentes dans l'image *sans impression* (`perl-base` est `Essential`). Analyse par CVE dans `docs/VEX-CANDIDATES.md` ; le seuil n'a pas été touché — voir §17 |
| P14 | Build reproductible, images épinglées par empreinte | **FAIL** | l'image de base est épinglée par empreinte, mais **dix actions GitHub sont épinglées par tag mutable** (`@v7`, `@v4`), de même que les images MySQL, Playwright, gitleaks et trivy du gate — voir §17 |
| P15 | Une seule image canonique de production, avec impression | **PASS** | un seul `Dockerfile`, étage `production` avec AMC ; compose, recette et CI construisent le même artefact ; recette **28/28**, dont l'annonce de version par l'image |
| P16 | Vivacité et disponibilité distinctes et réelles | **PASS** | `/api/health` et `/api/ready` ; 4 vérifications HTTP dans `surface-http.integration.spec.ts` ; le conteneur interroge la disponibilité |
| P17 | Arrêt gracieux | **PASS** | `scripts/smoke-arret-gracieux.ts` : SIGTERM pendant une remise en vol, copie entière, sortie 0 ; 4 tests unitaires sur l'ordre |
| P18 | Contre-pression, remise idempotente | **PASS** | `remise-concurrente.integration.spec.ts` : une remise rejouée rend mot pour mot la même réponse ; audit des files en §5 |
| P19 | Observabilité — 0 `console.*`, supervision d'erreurs | **PASS** | `journalisation.spec.ts` : 0 appel direct ; supervision branchée sur `logger.error`, 9 tests de nettoyage, `scripts/verifier-supervision.ts` |
| P20 | CI : tests navigateur obligatoires, aucun job tolérant l'échec | IN_PROGRESS | aucun `continue-on-error`, cinq travaux requis ; mais le gate demande **trois exécutions vertes consécutives** sur le HEAD candidat, et une seule est acquise |
| P21 | 0 test en échec, 0 ignoré, 0 instable (0 reprise) | **FAIL** | la reprise de navigation est retirée du code (`CUSTOM_NAVIGATION_RETRY = 0`, `PLAYWRIGHT_RETRIES = 0`) et la cause est trouvée : un défaut du pilote Firefox de Playwright face à l'échange de groupe de contextes que provoque COOP. Preuve indépendante faite — Firefox de série piloté par Marionette, 400 navigations, 0 blocage. Reste le seul élément manquant : **trois exécutions CI vertes consécutives**, sans code entre elles et sans relance manuelle — voir §16 |
| P22 | Couverture : 100 % sur les domaines critiques, ≥ 95 % global serveur | **PASS** | 98,4 % / 96,4 % / 97,5 % / 98,6 % ; seuils posés dans `vitest.config.ts` — voir §9 |
| P23 | Accessibilité — 0 violation critique ou sérieuse | **PASS** | `e2e/accessibilite.spec.ts` : axe sur 10 écrans, 3 moteurs, plus deux parcours au clavier seul — voir §7 |
| P24 | Régression visuelle sur les écrans critiques | **PASS** | sept écrans, références produites dans l'image Docker de Playwright, comparées par la CI — voir §13 |
| P25 | Aucune erreur navigateur inattendue tolérée | **PASS** | surveillance installée sur chaque test sans qu'il ait à la demander ; exceptions, pageerror, `console.error` et 5xx ; aucun filtre global |
| P26 | 0 code mort, 0 dépendance inutilisée, 0 duplication métier | **PASS** | `knip` ne signale plus rien ; `jscpd` 1,34 % — voir §4 |
| P27 | `main` protégée, tags protégés | **PASS** | protection posée et éprouvée : poussée directe refusée, réécriture de `v1.0.0-rc1` refusée — voir §11 |
| P28 | Sauvegarde et restauration éprouvées | **PASS** | `scripts/sauvegarde.sh` et `scripts/restauration.sh` ; répétition réelle — base détruite puis restaurée, application redémarrée dessus — voir §10 |
| P29 | Migration de production : sauvegarde → préflight → migration → postflight | **PASS** | `scripts/migration-production.sh`, jouée d'un schéma rc1 portant des copies : 6 → 10 migrations, incidents JSON recopiés — voir §10 |
| P30 | Retour arrière éprouvé | **PASS** | `scripts/repli-production.sh` ; répétition avec incident simulé, retour sur l'empreinte précédente — voir §10 |
| P31 | Performance non régressée (p95 < 500 ms, 0 erreur) | IN_PROGRESS | trois campagnes conformes (39,1 / 36,7 / 36,6 ms, 0 erreur) **mais sur un banc invalide** : disque à 100 %. À rejouer sur environnement propre contre le HEAD final — voir §18 |
| P32 | Endurance sans fuite | IN_PROGRESS | 30 min, 1 801 copies, 0 erreur, mémoire plafonnée — **même banc invalide**, à rejouer sur environnement propre contre le HEAD final — voir §18 |
| P33 | Déploiement et recette sur staging | BLOCKED_EXTERNAL | aucune cible désignée |
| P34 | Déploiement et recette de production | BLOCKED_EXTERNAL | aucune cible désignée |

**PASS : 27 / 34. FAIL : 3. IN_PROGRESS : 4. BLOCKED_EXTERNAL : 2.**

Le décompte précédent — « 32 / 34 » — était faux. Il est corrigé ci-dessus, et
ce qui l'a rendu faux est écrit en §16 et §17 plutôt que résumé.

P33 et P34 restent `BLOCKED_EXTERNAL` faute de cible désignée. Mais ce ne sont
plus les seules exigences ouvertes : trois gates sont en échec et quatre sont en
cours. **`v1.0.0-rc2` est interdit, et `v1.0.0` a fortiori.**

---

## 4. Duplication : ce qui reste, et pourquoi

`jscpd --min-lines 8` : 1,34 % de lignes dupliquées. Ce qui subsiste a été
regardé une à une :

- **Fixtures de tests** (une trentaine de blocs). Un test se lit de haut en bas ;
  factoriser sa mise en place le rend plus court et moins clair.
- **`GenerationPanel` ≡ `PrintPanel`** (10 lignes) : un bouton de fermeture dans
  un en-tête de carte. **`Evaluation` ≡ `Preview`** (11 lignes) : une barre
  « Précédent / Suivant ». Du balisage voisin dans des écrans qui divergent
  ensuite ; en extraire un composant coûterait plus qu'il ne rapporte.
- **Trois requêtes de 9 à 11 lignes** — « lire un tirage », « lire une session » —
  identiques parce que la table l'est. Les enrober masquerait ce qu'elles lisent.

Ce qui a été supprimé relevait d'une autre nature : deux calculs d'une même
note, deux calculs d'un même score de suspicion, deux réponses à « cette copie
est-elle inscriptible ? », deux chemins d'écriture vers la table corrigée. Ces
duplications-là ne se contentent pas de répéter : elles divergent.



---

## 5. Contre-pression : ce qui attend, ce qui refuse

Sous charge, un service a deux façons de mal se comporter : refuser du trafic
légitime, ou accepter sans fin ce qu'il ne peut pas traiter. La seconde est la
pire — elle transforme une pointe en panne, et l'utilisateur n'apprend rien
avant l'expiration de son propre délai. Inventaire de ce qui borne quoi.

| File ou ressource | Borne | Comportement au plafond |
|---|---|---|
| Connexions MySQL | `DB_POOL_SIZE` = 60 | **attend** — `queueLimit: 0`, file non bornée |
| Corps de requête | 10 Mo | refuse (`413`) |
| Ouverture de session, par candidat | 5 / min | refuse (`429`) |
| Ouverture de session, par adresse IP | 600 / 5 min | refuse (`429`) |
| Enregistrement de brouillon, par copie | 120 / min | refuse (`429`) |
| Signalement d'incidents, par copie | 10 / min | refuse (`429`) |
| Heartbeat, par copie | 6 / min | refuse (`429`) |
| Rédaction assistée, par enseignant | 12 / 5 min | refuse (`429`) |
| Remise de copie | aucune | idempotente : une remise déjà faite se redonne |
| Envoi d'un brouillon depuis le client | 8 s | bascule sur IndexedDB, rejoue toutes les 5 s |
| Arrêt du serveur | 20 s | ferme quand même |

**La file du pool n'est pas bornée, et c'est délibéré.** Une remise de copie
enchaîne une vingtaine d'allers-retours ; deux cents copies rendues dans la même
seconde — la fin d'une épreuve — demandent plus de connexions qu'il n'y en a.
Refuser serait perdre des copies ; faire attendre les sert toutes. La mesure de
charge donne le prix de cette attente : p95 ≈ 2,09 s sur deux cents remises
artificiellement simultanées, sans une seule erreur. C'est le seul endroit du
système où l'on préfère attendre à refuser, et c'est le bon.

**`answerSave` était déclarée et jamais appliquée.** La seule écriture qu'un
élève peut répéter à volonté n'avait aucune borne. Elle en a une, calibrée sur
le pire cas honnête avec une marge du simple au double.

**La remise est idempotente.** La copie est écrite et corrigée, la réponse HTTP
se perd, le client réessaie : il reçoit mot pour mot ce que la première remise
avait rendu — mêmes points, même jeton de résultats, même date de fin. Le client
réessaie donc deux fois de lui-même avant d'afficher un échec.


---

## 6. Intégrité : les treize tables

Un invariant que seule l'application vérifie n'est pas un invariant. Entre le
`SELECT` qui constate et l'`INSERT` qui écrit, une seconde requête passe — et sur
une salle d'examen, cette seconde requête existe : deux surveillants sur le même
paquet, un enseignant qui valide deux fois, un client qui rejoue après une
coupure.

| Table | Ce que la base garantit | Depuis |
|---|---|---|
| `users` | `unionId` unique | origine |
| `evaluations` | clé étrangère vers le propriétaire, `set null` | origine |
| `questions` | clé étrangère vers l'évaluation, `cascade` | origine |
| `questions` | **une place unique par évaluation** | 0009 |
| `sessions` | clé étrangère vers l'évaluation | origine |
| `responses` | **une réponse par (copie, question)** | 0005 |
| `responses` | clés étrangères vers la copie et la question, `restrict` | origine |
| `answer_drafts` | clé primaire (copie, question) | origine |
| `cheat_events` | clé étrangère vers la copie, `cascade` | origine |
| `classes` | clé étrangère vers le propriétaire | origine |
| `students` | clé étrangère vers la classe, `cascade` | origine |
| `paper_exams` | clés étrangères vers évaluation, classe et auteur | origine |
| `paper_copies` | **un élève, une copie par tirage** | 0009 |
| `paper_copies` | **une session corrigée, une seule copie** | 0009 |
| `grade_audit` | clés étrangères vers copie, réponse, question, auteur | 0004 |

Les trois contraintes de la migration 0009 ferment des trous qui produisaient
des notes fausses sans rien signaler : deux copies pour un même élève sur une
même épreuve — le relevé en comptait deux, la moyenne était faussée ; une même
note rattachée à deux élèves ; deux questions à la même place, rendant la
numérotation imprimée et la grille de saisie illisibles.

Aucune n'efface quoi que ce soit. Sur une base contenant des doublons, MySQL
refuse l'ordre et la migration s'arrête : deux copies pour un même élève sont
une information, probablement le signe d'un incident de saisie, et leur sort se
décide avec l'enseignant. `scripts/preflight-invariants.ts` les énumère avant,
avec les noms et les notes, et signale par ailleurs quatre états anormaux qui
n'entraînent pas de contrainte — notes hors barème, notes sur 20 hors bornes,
copies finies avant d'avoir commencé, copies rendues dont les réponses n'ont pas
de date de correction.


---

## 7. Accessibilité : ce que l'audit a trouvé

Un élève ne choisit ni son matériel ni ses capacités, et une épreuve ne se
repasse pas. Le seuil est « aucune violation critique, aucune violation
sérieuse » sur dix écrans et trois moteurs, plus deux parcours menés au clavier
seul — l'élève qui compose, l'enseignant qui circule.

Ce que le premier passage a trouvé, et qui était là depuis le début :

| Trouvé | Conséquence |
|---|---|
| Le temps restant en gris clair sur le bandeau rouge des dernières minutes — 1,9 contre 1 | Illisible au moment précis où l'élève le regarde |
| Quatre barres de progression sans nom accessible | Un lecteur d'écran annonce « barre de progression », sans dire de quoi |
| Le rouge d'alerte portant du texte blanc — 3,76 contre 1 | Sous le seuil de 4,5 exigé pour du texte |
| Le bouton « Terminer » en vert 600 — 3,15 contre 1 | Le bouton qui rend la copie |
| Le champ mathématique : puits de saisie sans nom | « Édition de texte », sans dire de quelle question |
| Son texte de substitution — 1,87 contre 1 | Un texte d'aide qu'on ne peut pas lire n'aide personne |
| Les formules KaTeX : `aria-label` sur un `<span>` sans rôle | L'étiquette était purement ignorée ; restait l'énoncé glyphe par glyphe |
| Les liens des pages légales, distingués par la seule couleur | Invisibles pour qui ne perçoit pas cette différence |
| Gris 400 sur blanc, à cinq endroits — 2,53 contre 1 | Texte secondaire illisible |

**Une seule exception, nommée.** `<math-field>` est un élément focusable qui
contient un puits de saisie lui-même focusable : axe y voit des contrôles
imbriqués, et c'est exact. C'est aussi la façon dont MathLive est construit, et
nous n'y pouvons rien sans le réécrire. Plutôt que de désactiver la règle
partout ou d'exclure le champ de tout examen, l'audit se fait en deux passes :
le reste de la page avec la règle, le champ avec toutes les autres.

**Un défaut trouvé en chemin, sans rapport avec l'accessibilité.** L'audit a
montré le bandeau rouge de dernière minute sur une épreuve qui commençait. Le
minuteur démarrait avant de connaître la durée : celle-ci vaut zéro le temps
qu'elle revienne du serveur, et un minuteur de zéro seconde est un minuteur
déjà écoulé. L'élève voyait 00:00 sur fond rouge en reprenant sa copie après un
rechargement, et le minuteur déclenchait dans cet état la remise automatique
pour temps dépassé. En local la durée revient en vingt millisecondes et rien ne
se voyait ; sur le réseau d'un établissement, elle met plus d'une seconde.


---

## 8. Les instabilités, et ce qu'elles cachaient

`retries = 0`, du début à la fin. Chaque échec intermittent a été instruit
jusqu'à sa cause ; aucun n'a été absorbé par une reprise. Ce qu'ils cachaient :

| Symptôme | Cause réelle |
|---|---|
| Quinze parcours de saisie tombent d'un coup | MathLive 0.110 ne prend plus le focus au clic : il le déplace ensuite vers un puits caché. Un robot frappe dans l'intervalle, pas un élève |
| Le champ mathématique reste vide sur Gecko et WebKit | L'hôte se déclare actif avant le puits ; on attend désormais le puits |
| Une réponse « perdue » après un rechargement | Rien n'était perdu : le parcours enchaînait ses « Suivant » à intervalle fixe et sautait la question |
| Une réponse réellement perdue | La temporisation d'enregistrement était unique et partagée : changer de question annulait l'envoi de la précédente |
| Trois parcours en échec sur le serveur de production | Une migration appliquée pendant que l'ancienne version tournait — l'artefact du moment, pas un défaut |
| Le premier champ d'un rechargement toujours vide | Le motif des fichiers versionnés attendait un point là où Vite met un tiret : rien n'était mis en cache, tout se retéléchargeait |
| Treize parcours blancs sous WebKit | `upgrade-insecure-requests` sur une adresse en clair |
| Une erreur de console à chaque chargement | Zod découvrait par exception s'il pouvait compiler ses schémas |
| Firefox se ferme vers la vingtième page en CI | Contrainte de mémoire du runner : un fichier à la fois, dans un navigateur neuf |
| Une navigation qui expire à quatre-vingt-dix secondes | L'état hors ligne d'un test débordait sur le suivant, sous Gecko |

Aucune de ces lignes n'aurait été écrite si la suite avait eu le droit de réessayer.


---

## 9. Couverture : ce qui est atteint, et ce qui ne l'est pas

Mesure du 31 août 2026, sur `api/**`, `contracts/**` et `db/*` — 1 143 tests,
89 fichiers :

| Métrique | Global | Exigence |
|---|---|---|
| Instructions | 98,44 % | ≥ 95 % |
| Branches | 96,36 % | ≥ 95 % |
| Fonctions | 97,53 % | ≥ 95 % |
| Lignes | 98,58 % | ≥ 95 % |

Les seuils sont posés dans `vitest.config.ts` et font échouer la suite : ce
n'est pas une mesure, c'est un gate. **100 %** sur les quatre métriques est
exigé de :

`api/grading/**` · `api/anticheat/**` · `api/kimi/**` · `api/queries/ownership`
· `api/queries/session-access` · `api/queries/connection` · `api/lib/csrf` ·
`api/lib/security-headers` · `api/lib/cookies` · `api/lib/base-url` ·
`api/lib/rate-limit` · `api/paper/paper-service` · `api/paper/manual-entry` ·
`api/paper/amc-runner` · `api/paper/parse-roster`

Aucune directive `c8 ignore` ou `istanbul ignore` n'existe dans le dépôt, et
aucune exclusion n'a été ajoutée au rapport pour arranger un chiffre.

### Ce qui reste, et pourquoi

Trois familles, énumérées plutôt que dissimulées.

**Ce qui est éprouvé, mais pas par Vitest.** Le démarrage de production de
`api/boot.ts` (lignes 209-236) ne s'exécute que sous `NODE_ENV=production` : il
est éprouvé par la recette Docker, qui lance l'image réelle, et par les
parcours navigateur exécutés contre la construction de production.
`installerArretGracieux` pose des gestionnaires de signaux : il est éprouvé par
`scripts/smoke-arret-gracieux.ts`, qui envoie un vrai SIGTERM à un vrai serveur
pendant une remise de copie. Les gardes d'entrée en ligne de commande de
`db/migrate.ts` et `db/seed.ts` ne se déclenchent que lancées par `node` : la
recette Docker et le travail Migrations les exécutent l'une et l'autre.

**Ce qui demande une panne matérielle.** `api/lib/readiness.ts` distingue
« dégradé » de « hors service » pour le pool saturé, le disque plein et
l'absence d'AMC. Provoquer ces états en test demanderait de remplir un disque
ou d'épuiser un pool ; le chemin nominal et l'échec de la base sont éprouvés,
les états intermédiaires ne le sont pas.

**Des gardes que rien ne peut atteindre aujourd'hui.** `requireActive` et
`requireRole` revérifient la présence de l'utilisateur que `requireAuth` a déjà
imposée. Ces deux lignes sont conservées : elles protègent un second site
d'appel qui composerait les intergiciels autrement, et retirer une vérification
d'autorisation pour gagner un point de couverture serait exactement le mauvais
échange. Le même raisonnement vaut pour une poignée de replis `?? …` placés
derrière une validation qui les rend inaccessibles.

Ce qui n'entrait dans aucune de ces trois familles a été **supprimé** :
`contracts/errors.ts` en entier, le repli du niveau de journal, la garde du
barème de suspicion, les onze variantes du message d'erreur, et le repli de
durée d'une session dont la colonne ne peut pas être nulle.


---

## 10. Sauvegarde, migration, repli : ce que les répétitions ont montré

Trois procédures, écrites puis **jouées**. Une procédure qu'on n'a jamais
exécutée est une hypothèse, et les trois répétitions ont chacune trouvé quelque
chose que la lecture n'aurait pas trouvé.

### Sauvegarde et restauration

`scripts/sauvegarde.sh` prend la base et les tirages ensemble, dans une archive
horodatée : cliché en une seule transaction — sans verrou, une épreuve peut se
dérouler pendant —, archive des tirages, manifeste (version, empreinte git,
base, date) et empreintes SHA-256. Le script **refuse** de rendre la main si le
cliché ne contient pas les treize tables.

`scripts/restauration.sh` vérifie les empreintes avant de toucher à quoi que ce
soit, restaure, puis **compte** ce qu'il a remis. Une base restaurée dont le
journal des migrations est vide arrête le script.

**Répétition** — base migrée sauvegardée, base détruite (`DROP DATABASE`),
dossier des tirages effacé, puis restauration : 1 évaluation, 20 questions,
2 copies, 5 réponses, 10 migrations, 1 fichier de tirage. L'application a été
redémarrée dessus et a servi l'évaluation restaurée. `RESTORE_DRILL = PASS`.

Ce que la répétition a montré : l'archive des tirages, extraite par
l'utilisateur qui restaure, revenait avec les droits de celui-ci et non ceux du
conteneur — `/api/ready` répondait alors « tirages : EACCES ». Le script rend
désormais le dossier à l'uid de l'application, ou le dit à voix haute quand il
ne le peut pas.

### Migration de production

`scripts/migration-production.sh` enchaîne cinq étapes dont chacune peut
arrêter la suivante : sauvegarde vérifiée, état avant, quatre préflights,
migration, postflight. Aucun préflight ne corrige quoi que ce soit.

**Répétition** — sur une base montée au schéma de `v1.0.0-rc1` (six migrations)
et peuplée : un enseignant, une classe, trois élèves, deux copies notées, cinq
réponses, et deux incidents de surveillance encore rangés dans l'ancienne
colonne JSON `sessions.cheatEvents`.

| Étape | Résultat |
|---|---|
| Sauvegarde | archive vérifiée, treize tables |
| Préflights | quatre passés ; un état anormal signalé sans bloquer — une copie close dont les réponses n'ont pas de date de correction |
| Migration | 6 → 10 migrations |
| Postflight | journal avancé, invariants tenus |
| Incidents JSON | 2 incidents recopiés dans `cheat_events`, type et horodatage préservés, puis la colonne retirée |

### Repli

`scripts/repli-production.sh` arrête la version en place par `docker stop`
— SIGTERM, donc arrêt gracieux —, restaure la base et les tirages, redémarre
l'image **désignée par son empreinte**, puis vérifie que le service se déclare
prêt et annonce la version attendue.

**Répétition** — une version en service, une sauvegarde, puis un incident
simulé : dix questions supprimées, toutes les notes remises à zéro, le sujet
imprimé effacé. Après repli : service prêt sur les six contrôles, version
annoncée `v1.0.0-rc1` avec son empreinte git, vingt questions, deux copies avec
leurs notes, le sujet revenu. `ROLLBACK_DRILL = PASS`.

Ce que la répétition a montré : `scripts/recette-docker.sh` construisait l'image
**sans** `APP_VERSION` ni `GIT_SHA`. La recette éprouvait donc un artefact qui
répondait « version : "" » — pas celui qui part en production. La recette passe
désormais les mêmes arguments que la CI, et vérifie que l'image annonce sa
version et son empreinte.


---

## 11. Ce que le dépôt refuse désormais

| Objet | Règle | Éprouvée |
|---|---|---|
| `main` | les cinq travaux de la CI doivent être verts, et la branche à jour | une poussée directe est refusée |
| `main` | ni poussée forcée, ni suppression | la remise en arrière est refusée |
| `main` | **les administrateurs y sont soumis** | vérifié depuis un compte administrateur |
| `refs/tags/v*` | ni suppression, ni réécriture, ni mise à jour | une réécriture de `v1.0.0-rc1` est refusée |

Les administrateurs sont soumis à la règle. C'est un choix, et il a un coût :
le propriétaire du dépôt ne peut plus corriger `main` en poussant directement,
il lui faut une branche et une demande de fusion — ou desserrer la règle le
temps d'un geste. Le contraire aurait rendu la protection décorative : la
première vérification, faite depuis un compte administrateur, est passée à
travers.

Un incident au passage, consigné ici parce qu'il fait partie de ce qui a été
appris : cette première vérification a **poussé la branche de durcissement sur
`main`** — en avance rapide, sans rien réécrire ni perdre. `main` a été remise
à `90fb380`, la protection resserrée, et la vérification refaite : elle échoue
maintenant, comme elle le doit.


---

## 12. Charge : la mesure rejouée, et ce qu'elle a trouvé

> **Ces chiffres ne valent pas comme preuve finale.** Ils ont été relevés sur un
> poste dont le disque était plein (voir §17, `FINAL_RELEASE_ENVIRONMENT`). Ils
> sont conservés parce qu'ils ont fait apparaître un défaut réel — le délai de
> garde des connexions — et parce qu'ils donnent un ordre de grandeur. La mesure
> qui comptera sera rejouée sur environnement propre, contre le HEAD final.

Le schéma a changé — quatre migrations, trois contraintes d'unicité — et le
chemin de remise aussi : prise atomique de la copie, score de suspicion,
jeton de résultats. La mesure d'acceptation a donc été rejouée en entier.

### Trois campagnes consécutives

`bash scripts/mesure-acceptation.sh 3`, 200 élèves, contre la construction de
production sur base migrée.

| Exécution | p50 | p95 | p99 | Erreurs HTTP | Échecs métier | Copies remises | Remise seule (p95) |
|---|---|---|---|---|---|---|---|
| 1 | 7,56 ms | **39,08 ms** | 51,72 ms | 0 / 2600 | 0 / 200 | 200 | 55,00 ms |
| 2 | 6,58 ms | **36,74 ms** | 48,86 ms | 0 / 2600 | 0 / 200 | 200 | 54,04 ms |
| 3 | 6,53 ms | **36,58 ms** | 48,63 ms | 0 / 2600 | 0 / 200 | 200 | 52,04 ms |

Pour mémoire, `v1.0.0-rc1` sur la même machine : p95 36,02 / 35,60 / 39,65 ms,
remise seule 52 / 52 / 58 ms. **Parité**, à l'intérieur du bruit de mesure : la
dégradation est inférieure à 10 % sur les trois exécutions, et la remise elle-même
est légèrement plus rapide qu'à rc1 malgré la prise atomique et le score de
suspicion ajoutés depuis.

### Ce que la mesure a trouvé

Les premières campagnes étaient erratiques : p95 de 298 ms, puis 36 ms, puis
273 ms, et une remise sur deux cents **refusée en une milliseconde**, sans la
moindre erreur côté serveur — le serveur n'avait rien vu passer.

Node ferme une connexion inactive au bout de **cinq secondes**. Un élève qui
réfléchit plus longtemps entre deux gestes retrouve une connexion que le serveur
vient de fermer : sa requête suivante part dans un tuyau déjà clos et revient en
erreur de transport. Sur une remise de copie, cela veut dire une copie qui ne
part pas, et rien dans les journaux pour l'expliquer.

Le serveur garde désormais ses connexions ouvertes soixante-cinq secondes, avec
un délai d'en-têtes juste au-dessus — au-delà du délai d'inactivité des clients
usuels et de celui d'un répartiteur placé devant. Les trois campagnes qui
suivent ce changement sont propres et régulières ; les tails ont disparu en même
temps que l'erreur.

C'est le genre de défaut qu'aucune relecture ne trouve et qu'aucun test
fonctionnel ne reproduit : il faut deux cents élèves qui prennent le temps de
réfléchir.


---

## 13. Régression visuelle

Sept écrans, ceux dont une déformation coûte le plus cher :

| Image | Écran | Ce qu'elle protège |
|---|---|---|
| `eleve-accueil.png` | avant de commencer | le bouton de démarrage et les consignes |
| `eleve-question-qcm.png` | une question à choix | les propositions, le minuteur, la progression |
| `eleve-question-math.png` | une réponse courte | le champ mathématique et son clavier |
| `enseignant-tableau-de-bord.png` | tableau de bord | les cartes qui débordaient sur tablette |
| `enseignant-liste-evaluations.png` | liste des évaluations | les libellés longs et leur troncature |
| `enseignant-saisie-papier.png` | grille de saisie | l'alignement des colonnes — un décalage y fausse un paquet entier |
| `enseignant-evaluation.png` | atelier de rédaction | le rendu KaTeX dans l'éditeur |

Les références sont produites **dans l'image Docker de Playwright**, la même
ici et sur la CI. Comparées depuis un poste de travail, elles compareraient
d'abord des polices : la première vraie régression se perdrait dans le bruit.

`npm run e2e:visuel` compare ; `npm run e2e:visuel:references` régénère. La CI
n'exécute que le premier. **Aucune image n'est mise à jour automatiquement** :
une différence doit être regardée, et si le changement est voulu, la nouvelle
image est régénérée puis relue dans le diff comme n'importe quel fichier.


---

## 14. Endurance

> **Même réserve qu'en §12** : relevé sur un poste à disque plein, donc
> indicatif et non probant. À rejouer sur environnement propre.

`PID_SERVEUR=… DUREE=30m bash scripts/endurance.sh`

Une session par seconde pendant trente minutes, contre la construction de
production. Ce que ce test cherche n'est pas une latence — l'acceptation s'en
charge — mais une **pente**.

| | |
|---|---|
| Copies remises | 1 801 |
| Requêtes | 16 209 |
| Erreurs HTTP | 0 |
| Échecs métier | 0 |
| p95 | 34,84 ms |
| p99 | 48,85 ms |

| Tranche | Mémoire résidente | Connexions à la base |
|---|---|---|
| 0–5 min | 201,0 Mo | 50 |
| 5–15 min | 203,6 Mo | 55 |
| 15–25 min | 204,6 Mo | 55 |
| 25–30 min | 204,7 Mo | 55 |

La courbe **plafonne** : +0,41 Mo entre les dix dernières minutes et la tranche
10–20 min. Ce n'est pas la signature d'une fuite, c'est un pool et un tas qui
atteignent leur régime. Les connexions se stabilisent à cinquante-cinq, sous la
limite de soixante, et les descripteurs de fichiers ne bougent plus après la
montée en charge initiale.

---

## 15. Le défaut le plus grave, trouvé par une image

La régression visuelle a été écrite pour surveiller des mises en page. La
première image de l'écran de l'élève a montré autre chose :

> La limite de `$f(x)=\dfrac{3x^2-2x+1}{x^2+5}$` en `$+\infty$` vaut :

**L'élève voyait la source LaTeX.** Dollars, contre-obliques, accolades. Pendant
que l'enseignant, lui, voyait la formule rendue dans son éditeur — parce que
l'éditeur passait par `MathLatex` et que l'écran de composition affichait le
texte brut.

Sur une évaluation de mathématiques, cela rend la copie entière illisible. Le
défaut vivait dans deux fichiers — `src/pages/Evaluation.tsx` pour l'élève,
`src/pages/Preview.tsx` pour l'aperçu enseignant — et dans quatre endroits :
l'énoncé et les propositions, deux fois.

Aucun test ne le voyait. Les parcours vérifiaient que l'élève peut répondre,
enregistrer, revenir, rendre ; le rendu mathématique n'était éprouvé que sur
les écrans de l'enseignant. Deux cas ont été ajoutés : l'énoncé et les
propositions d'un QCM sont rendus, aucune source LaTeX ne reste à l'écran, et
la source est retrouvée dans l'annotation MathML — ce qui prouve un rendu, pas
une recopie.

Une seconde leçon, sur l'outil lui-même : la comparaison d'images tolérait 1 %
de pixels différents. Sur une page de 1 280 × 900 majoritairement blanche, cela
laisse passer onze mille pixels — assez pour qu'un énoncé change entièrement
sans que rien ne bronche. Le seuil est descendu à un pour deux mille, et c'est
à ce moment-là que la comparaison a signalé le changement.


---

## 16. E2E_STABILITY — rouvert

### Ce qui a été présenté comme acquis, et ne l'était pas

La ligne P21 disait « 0 instable (0 reprise) » alors que le code des parcours
contenait une reprise de navigation, et que la dernière exécution CI en avait
imprimé une. Deux notions étaient confondues sous le mot « reprise » :

| Grandeur | Valeur mesurée | Exigence |
|---|---|---|
| `TEST_RETRY` (reprise de scénario par Playwright) | 0 | 0 |
| `NAVIGATION_REPLAY` (seconde `page.goto` maison) | **1** sur la CI 33363175722 | 0 |
| `E2E_FLAKY_RETRY_REQUIRED` | **NON SATISFAIT** | SATISFAIT |

Un scénario qui aboutit parce qu'une navigation a été rejouée n'est pas un
scénario vert. La distinction entre « reprise de test » et « reprise de
navigation » est une distinction de vocabulaire, pas de nature.

### Ce qui a été retiré

`e2e/fixtures.ts` ne contient plus ni `navigationsRejouees`, ni
`compteurDeNavigationsRejouees`, ni seconde `page.goto`, ni délai de navigation
particulier. Une navigation qui ne part pas fait échouer le scénario et produit
ses diagnostics.

```
CUSTOM_NAVIGATION_RETRY = 0
PLAYWRIGHT_RETRIES = 0
```

### Ce qui reste à faire

Trouver la cause reproductible du blocage sous Gecko. Ce qui est écarté à ce
jour, mesure à l'appui, est consigné plus bas ; ce n'est pas une conclusion,
c'est un point de départ.

**Taux de référence mesuré** — six exécutions complètes du projet Firefox sur un
banc dédié, sans reprise : **trois exécutions en échec sur six**, quatre
scénarios sur 138, soit environ 3 % des navigations.

| Hypothèse | Vérification | État |
|---|---|---|
| Mémoire du poste | 14 Go libres au moment du blocage | écartée |
| Réutilisation des connexions | persiste avec `network.http.keep-alive` à faux | écartée |
| Délai de garde du serveur | porté de 5 s à 125 s, au-delà des 115 s de Gecko | corrigé ; sans effet sur ce blocage |
| Navigateur usé par les tests précédents | un navigateur relancé pour chaque test le fait aussi | écartée |
| Lenteur | cinq minutes d'attente n'aboutissent pas | écartée : blocage définitif |
| Résolution de proxy, anticipation de connexion | désactivées par préférence Gecko | fréquence réduite, pas supprimée |
| Service worker | l'application n'en enregistre aucun | écartée |
| État hors ligne résiduel | 60 navigations avec `setOffline(false)` sur contexte neuf | non reproduit |
| Fermeture de contexte avec requêtes en vol | 30 itérations avec session réelle puis fermeture | non reproduit |
| Un seul fichier répété | 12 exécutions de `accessibilite.spec.ts` | non reproduit |
| Traçage Playwright actif sur chaque test | mesure en cours | **en cours d'instruction** |
| État partagé entre fichiers de spécification | à instruire | **ouvert** |
| Pression mémoire du runner | à instruire | **ouvert** |

### Le protocole de mesure

Chaque hypothèse est éprouvée de la même façon : six exécutions complètes du
projet Firefox, sans reprise, sur un banc dédié, en ne changeant qu'une chose.

| Bras | Ce qui change | Exécutions en échec |
|---|---|---|
| A — référence | rien | **3 / 6** |
| B | traçage Playwright désactivé | 1 / 6 |
| C | polices téléchargeables coupées dans Gecko | 3 / 6 |
| D | attente de silence réseau avant fermeture du contexte | 1 / 2 (interrompu) |
| E | un fichier par lancement, comme la CI | **1 / 6** |
| — | un navigateur neuf pour chaque test | 1 / 5 |

Aucun bras ne supprime le défaut. Le découpage par fichier — celui de la CI —
divise le taux par trois environ, sans l'annuler.

### Ce que la mesure a établi

1. **La requête ne part pas.** Le journal d'accès du serveur, ajouté au niveau
   `debug` pour cela, ne montre rien à l'heure du blocage : la dernière requête
   reçue précède l'échec d'une minute et demie.
2. **Ce n'est pas une lenteur.** Avec un délai de cinq minutes, la navigation
   n'aboutit pas davantage.
3. **Ce n'est pas de l'usure.** Un navigateur lancé pour ce seul test bloque
   aussi.
4. **Ce n'est pas le produit.** Les trois moteurs exécutent les mêmes scénarios
   contre le même serveur ; Chromium et WebKit ne bloquent jamais, sur aucune
   des trente-cinq exécutions mesurées.
5. **Les blocages se concentrent** sur `parcours-eleve.spec.ts` — le fichier
   dont chaque scénario laisse une copie ouverte, avec ses minuteurs, son
   enregistrement temporisé et son battement de présence.

### La cause

Le journal de protocole de Playwright, capturé au moment d'un blocage, la donne
sans ambiguïté.

```
SEND ► Page.navigate  url=…/evaluation?…  id=6477
◀ RECV {"id":6477,"result":{"navigationId":"nav-101"}}
◀ RECV Network.requestWillBeSent   …/evaluation?…
◀ RECV Page.navigationStarted      nav-101        ← une première fois
◀ RECV Network.responseReceived    (le serveur répond)
◀ RECV Runtime.executionContextsCleared
◀ RECV Runtime.executionContextCreated  ×2
◀ RECV Runtime.executionContextDestroyed ×2
◀ RECV Runtime.executionContextCreated  ×2
◀ RECV Page.navigationStarted      nav-101        ← une seconde fois
◀ RECV Network.requestFinished     (le document est là)
```

`Page.navigationCommitted` n'arrive **jamais** pour `nav-101` — alors que la
navigation précédente, `nav-100`, en a reçu un. `page.goto(waitUntil: "commit")`
attend donc un événement qui ne viendra pas, pendant que la page, elle, s'est
chargée normalement.

La séquence entre les deux `navigationStarted` — contextes d'exécution vidés,
détruits, recréés deux fois — est la signature d'un **échange de groupe de
contextes de navigation**. Ce qui le déclenche chez nous :
`Cross-Origin-Opener-Policy: same-origin`.

Mesure, sur le fichier où les blocages se concentrent, dix exécutions par bras :

| Bras | En-tête | Échecs |
|---|---|---|
| Contrôle | `same-origin` | **2 / 10** |
| F | `same-origin`, application désactivée dans Gecko | **0 / 10** |
| G | `same-origin-allow-popups` | **1 / 11** |

Adoucir l'en-tête ne suffit pas : c'est l'échange de groupe lui-même qui
déclenche le défaut, et il a lieu dans les deux cas.

### Ce qui a été décidé

Le produit **garde `same-origin`**. C'est une protection réelle, et la retirer
pour contourner un défaut d'outillage serait le mauvais échange. C'est le
navigateur de test, et lui seul, qui cesse d'appliquer l'en-tête —
`browser.tabs.remote.useCrossOriginOpenerPolicy: false` dans les préférences
Gecko du projet Playwright.

Ce que cela coûte, dit franchement : sous Gecko, nos parcours n'éprouvent plus
le comportement de l'application pendant un échange de groupe de contextes.
Chromium et WebKit appliquent l'en-tête normalement — la couverture reste réelle
sur deux moteurs sur trois — et la présence de l'en-tête est vérifiée sur une
réponse réelle par `api/lib/__tests__/en-tetes-de-securite.spec.ts`.

Ce n'est pas une reprise : rien n'est rejoué, `retries` reste à zéro, et un
scénario qui échoue échoue toujours. C'est la suppression d'une cause, à
l'endroit où elle peut l'être sans affaiblir le produit.

### Après correction

Huit exécutions consécutives des trois moteurs, sur le banc de diagnostic, sans
reprise et sans reprise de navigation :

| Exécution | Chromium | Firefox | WebKit |
|---|---|---|---|
| 1 à 8 | 23 / 23 | 23 / 23 | 23 / 23 |

Vingt-quatre exécutions de projet, cinq cent cinquante-deux scénarios, aucun
échec. La référence était de trois exécutions complètes en échec sur six.

```
PLAYWRIGHT_RETRIES = 0
CUSTOM_NAVIGATION_REPLAY = 0
E2E_FAIL = 0
E2E_SKIP = 0
```

Reste à confirmer sur la CI, où le gate exige trois exécutions vertes
consécutives sans intervention.

### La contrepartie : Firefox de série, COOP appliquée

Désactiver l'application de COOP dans le navigateur de test creuse un trou dans
la couverture. Ce trou est comblé par une preuve indépendante, exigée comme
portail à part entière : **si elle échoue, P21 reste `FAIL`**, quelle que soit
la couleur des parcours Playwright.

`scripts/smoke-firefox-coop.mjs` pilote un Firefox **de série** — celui du
système, ou le Firefox ESR de Debian en CI, jamais la variante corrigée
qu'embarque Playwright — par **Marionette**, le protocole d'automatisation de
Gecko lui-même, en TCP, sans geckodriver, sans WebDriver et sans une ligne de
Playwright. Il commence par vérifier que
`Cross-Origin-Opener-Policy: same-origin` est réellement présent sur chacune des
routes visitées : sans cela il refuse de tourner, car il ne prouverait rien.

Il distingue deux échecs, et la distinction est le cœur du sujet : une
navigation qui rend une erreur (la chaîne fonctionne), et une navigation qui ne
rend jamais la main (le défaut traqué).

| Passage | Navigateur | Navigations | `…NAVIGATION_FAIL` | `…HANG` | Médiane |
|---|---|---|---|---|---|
| 1 | Firefox 154.0.1 (système) | 100 | 0 | 0 | 85 ms |
| 2 | Firefox 154.0.1 (système) | 100 | 0 | 0 | 84 ms |
| 3 | Firefox 154.0.1 (système) | 100 | 0 | 0 | 83 ms |
| 4 | Firefox ESR 140.14.0 (conteneur CI) | 100 | 0 | 0 | 97 ms |

```
FIREFOX_NATIVE_COOP_NAVIGATION_FAIL = 0
FIREFOX_NATIVE_COOP_HANG = 0
```

Quatre cents navigations cumulées, deux versions de Gecko, COOP bel et bien
appliquée, aucun blocage. **Le défaut est dans le pilote de Playwright, pas
dans Gecko** — et l'application, elle, se comporte normalement sous l'en-tête
qu'elle envoie en production.

Le portail est câblé dans la CI (« Firefox de série, COOP appliquée »), sans
`continue-on-error`, et l'image de test est décrite par
`docker/firefox-natif.Dockerfile`.

### Et pour que la dérogation ne s'étende pas

`api/lib/__tests__/coop-inconditionnelle.spec.ts` échoue si :

- l'en-tête cesse d'être posé dans l'une des quatre configurations réelles
  (production ou non, adresse sécurisée ou non) ;
- la préférence Gecko apparaît ailleurs que dans `e2e/fixtures.ts` — la
  documentation exceptée, qui a le droit d'en parler ;
- le commentaire qui l'accompagne cesse de dire qu'elle ne vaut que pour le
  navigateur de test.

---

## 17. Les autres gates rouverts

### REPRODUCIBLE_BUILD — rouvert

`P14` était marqué `PASS` sur la foi de l'image de base épinglée par empreinte.
Le reste ne l'est pas :

| Entrée | Épinglage actuel | Exigé |
|---|---|---|
| `actions/checkout` | `@v7` | SHA complet |
| `actions/setup-node` | `@v7` | SHA complet |
| `actions/upload-artifact` | `@v7` | SHA complet |
| `docker/setup-buildx-action` | `@v4` | SHA complet |
| `docker/build-push-action` | `@v7` | SHA complet |
| image Node de base | empreinte | conforme |
| image MySQL des tests et recettes | tag | empreinte |
| image Playwright | tag | empreinte |
| gitleaks, trivy | tag | empreinte |

```
MUTABLE_CRITICAL_ACTIONS = 10
MUTABLE_RELEASE_IMAGES = 4
```

Un tag de version majeure se déplace : ce n'est pas un build reproductible.

### CONTAINER_VULNERABILITY_GATE — rouvert, et ce qu'il a révélé

`scripts/scan-image.sh` séparait les vulnérabilités HIGH/CRITICAL en deux :
celles qui portent une `FixedVersion` et les autres. Seules les premières
faisaient échouer le gate. Le contrat n'admet pas cette distinction : une CVE
sans correctif amont reste une CVE dans l'image qui sert des copies d'élèves.

L'exception est retirée. Le gate exige désormais zéro, et il échoue :

```
IMAGE_CRITICAL = 32
IMAGE_HIGH     = 139
```

Cent soixante-et-onze, **toutes sans correctif amont**, et presque toutes
apportées par la chaîne de dépendances d'`auto-multiple-choice` :

| Composant | CVE portées | Ce qu'il fait chez nous |
|---|---|---|
| ImageMagick et ses bibliothèques | 35 | traitement d'images de copies scannées |
| OpenEXR | 15 | format d'image HDR, tiré par ImageMagick |
| Perl et ses modules | 32 | AMC est écrit en Perl |
| libcurl | 8 | tiré par la chaîne AMC |
| glib, gir | 14 | tiré par la chaîne AMC |
| GDCM, libraw, autres | reste | formats d'image exotiques (DICOM, RAW) |

**C'est un blocage réel, pas une formalité.**

#### Ce qui a été fait : réduire le runtime par la mesure

La première issue — retirer ce qui ne sert pas — a été instruite, et elle a
donné beaucoup. L'analyse complète est dans
[docs/AMC-RUNTIME.md](docs/AMC-RUNTIME.md) ; en bref :

Une composition réelle a été tracée sur trois plans — les programmes exécutés
(`execve`), les modules Perl chargés (`%INC`), les bibliothèques natives
chargées (`LD_DEBUG=libs`). `auto-multiple-choice prepare --mode s` n'exécute
que `perl`, `pdflatex`, les outils `kpse*` et la génération de polices ; il ne
charge **aucun** module GTK, GraphicsMagick ou OpenCV, et **aucune** des
bibliothèques `libgio`, `libxml2`, `libexpat`, `libncurses`, `libpython3`.
Les deux seuls binaires compilés d'AMC, `AMC-detect` et `AMC-buildpdf`, sont
ceux de la lecture optique et de l'annotation ; ce sont eux qui font entrer
OpenCV.

L'image de production installe désormais les seules dépendances mesurées comme
nécessaires, et pose les fichiers d'AMC depuis ses paquets officiels épinglés à
`1.7.0-3` et vérifiés par SHA-256. Pas de `--force-depends`, pas de faux
paquet, pas de purge après coup, pas de `.so` supprimée à la main.

| | Avant | Après |
|---|---|---|
| `IMAGE_PACKAGES` | 443 | **179** |
| `IMAGE_SIZE` | 3 307 Mo | **988 Mo** |
| `IMAGE_CRITICAL` | 32 | **14** |
| `IMAGE_HIGH` | 139 | **48** |

La preuve fonctionnelle a été refaite en entier sur l'image réduite :

- matrice de six tirages — un élève, trente élèves, formules (`\dfrac`,
  racines, exposants, intégrale, `\mathbb{R}`), accents français, énoncé long
  multi-pages, vrai/faux : `MATRICE_PAPIER = PASS` ;
- **équivalence** avec l'image complète : même nombre de pages et texte extrait
  identique mot pour mot, sur les six cas — comparé sur les invariants
  fonctionnels, jamais sur l'empreinte des PDF, que `pdflatex` horodate ;
- deux tirages simultanés : aucun mélange, chacun identique à son tirage isolé ;
- recette Docker : **28 étapes sur 28**, chaîne enseignant complète comprise
  — imprimer, saisir les copies, relire les notes, « copie juste : 20/20 ».

#### Ce qui reste, et pourquoi P13 reste FAIL

Les 62 occurrences restantes — 26 CVE distinctes — sont analysées une par une
dans [docs/VEX-CANDIDATES.md](docs/VEX-CANDIDATES.md) :

```
RAW           = 62 occurrences (26 CVE distinctes)
NOT_AFFECTED  = 14 CVE
APPLICABLE    =  0 CVE
UNKNOWN       = 12 CVE
```

**Aucune n'a de correctif amont.** Et surtout, un fait qui change la nature du
problème : l'image *sans aucune impression* — l'application seule — porte déjà
**3 CRITICAL et 12 HIGH**, dont les huit CVE de `perl-base`, paquet `Essential`
de Debian présent dans toute image Debian. Le seuil « zéro HIGH, zéro
CRITICAL » est donc inatteignable sur une base Debian stable, avec ou sans AMC.

#### La nomenclature, désormais liée à l'image

`npm run sbom` ne décrivait que les dépendances npm : ni Debian, ni TeX Live,
ni AMC — c'est-à-dire ni rien de ce qui porte les vulnérabilités ci-dessus. Et
rien n'y rattachait la nomenclature à un artefact.

`scripts/sbom-image.sh` inventorie l'image elle-même — 342 composants sur
l'image candidate — et inscrit son empreinte dans le document, sous
`atelier:image:id`. En CI, il tourne sur **la même image que l'analyse**, sans
reconstruction entre les deux.

```
SBOM_IMAGE_ID = sha256:5dbb12d790e7c34a053aff4943d4bee572bd33d97ebaa99d8f1b0ad0a48efd60
```

**Le gate n'a pas été modifié et P13 reste `FAIL`.** Décider d'accepter un
risque résiduel, de changer de distribution de base, ou d'attendre les
correctifs amont n'est pas une décision d'ingénierie à prendre seul : les trois
voies sont posées en fin de `docs/VEX-CANDIDATES.md`, avec ce qu'elles coûtent.

### PROCESS_HYGIENE — rouvert

La campagne a laissé derrière elle, sans que rien ne le signale :

- deux sondes `node -e` à 90 % de processeur pendant 5 h 40 ;
- un serveur de production périmé occupant le port 3200 depuis 4 h 30, contre
  lequel une campagne de mesure a tourné sans que personne s'en aperçoive ;
- deux grappes `tsx` figées depuis 17 h ;
- deux bases jetables et une image de 3,3 Go.

Aucune recette ne vérifiait cela. C'est désormais une exigence :

```
PROJECT_BACKGROUND_SHELLS = 0
PROJECT_ORPHANS = 0
PROJECT_ZOMBIES = 0
STALE_TEST_SERVERS = 0
```

### FINAL_RELEASE_ENVIRONMENT — rouvert

Le poste de mesure est à **100 % de disque** (8,1 Go libres sur 913). Ce n'est
pas un environnement acceptable pour une preuve finale : risque `ENOSPC`,
comportement d'entrées-sorties non représentatif, Docker et MySQL affectés.

```
DISK_FREE_GIB = 8.1        exigé ≥ 20
DISK_FREE_PERCENT = 0.9    exigé ≥ 15, préféré ≥ 20
FINAL_LOCAL_BENCHMARK_ENV = INVALID
```

Les campagnes suivantes sont **définitivement invalides** et ne seront jamais
agrégées à un résultat valide :

| Campagne | Pollution |
|---|---|
| 1ʳᵉ (p95 538 ms) | construction d'image concurrente |
| 2ᵉ (298 / 36,7 / 273 ms) | deux sondes à 90 % de processeur |
| 3ᵉ (code 99) | serveur périmé sur le port 3200 |

La quatrième (39,1 / 36,7 / 36,6 ms) est cohérente, mais elle a été prise sur un
disque plein : elle vaut comme indication, pas comme preuve.

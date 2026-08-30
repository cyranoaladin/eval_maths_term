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
| Dernière mise à jour | 2026-08-30 — 6 lots livrés |

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
| P12 | Analyse de secrets dans notre CI | **PASS** | job `Sécurité` : gitleaks sur tout l'historique, `--exit-code 1` ; 5 signalements instruits nominativement dans `.gitleaksignore` |
| P13 | Chaîne d'approvisionnement — 0 vulnérabilité HIGH/CRITICAL, SBOM | **PASS** | `npm audit` : 0 ; SBOM CycloneDX 1.6, 127 composants, publié en artefact ; image : 0 vulnérabilité corrigeable |
| P14 | Build reproductible, images épinglées par empreinte | **PASS** | base épinglée par empreinte ; `scripts/relever-empreintes-images.sh` ; actions GitHub épinglées par version majeure |
| P15 | Une seule image canonique de production, avec impression | **PASS** | un seul `Dockerfile`, étage `production` avec AMC ; compose, recette et CI construisent le même artefact ; recette 27/27 |
| P16 | Vivacité et disponibilité distinctes et réelles | **PASS** | `/api/health` et `/api/ready` ; 4 vérifications HTTP dans `surface-http.integration.spec.ts` ; le conteneur interroge la disponibilité |
| P17 | Arrêt gracieux | **PASS** | `scripts/smoke-arret-gracieux.ts` : SIGTERM pendant une remise en vol, copie entière, sortie 0 ; 4 tests unitaires sur l'ordre |
| P18 | Contre-pression, remise idempotente | **PASS** | `remise-concurrente.integration.spec.ts` : une remise rejouée rend mot pour mot la même réponse ; audit des files en §5 |
| P19 | Observabilité — 0 `console.*`, supervision d'erreurs | IN_PROGRESS | `journalisation.spec.ts` : 0 appel direct. Supervision non branchée |
| P20 | CI : tests navigateur obligatoires, aucun job tolérant l'échec | IN_PROGRESS | cinq jobs écrits, aucun `continue-on-error` ; reste à les voir passer sur GitHub |
| P21 | 0 test en échec, 0 ignoré, 0 instable (0 reprise) | IN_PROGRESS | 857 tests, 39 parcours ; `fileParallelism: false` rétabli (l'option était ignorée depuis Vitest 4) |
| P22 | Couverture : 100 % sur les domaines critiques, ≥ 95 % global serveur | IN_PROGRESS | seuils actuels : 100 % sur `api/grading`, 80 % global |
| P23 | Accessibilité — 0 violation critique ou sérieuse | **PASS** | `e2e/accessibilite.spec.ts` : axe sur 10 écrans, 3 moteurs, plus deux parcours au clavier seul — voir §7 |
| P24 | Régression visuelle sur les écrans critiques | IN_PROGRESS | — |
| P25 | Aucune erreur navigateur inattendue tolérée | **PASS** | surveillance installée sur chaque test sans qu'il ait à la demander ; exceptions, pageerror, `console.error` et 5xx ; aucun filtre global |
| P26 | 0 code mort, 0 dépendance inutilisée, 0 duplication métier | **PASS** | `knip` ne signale plus rien ; `jscpd` 1,34 % — voir §4 |
| P27 | `main` protégée, tags protégés | IN_PROGRESS | — |
| P28 | Sauvegarde et restauration éprouvées | IN_PROGRESS | — |
| P29 | Migration de production : sauvegarde → préflight → migration → postflight | IN_PROGRESS | 0006 et 0007 ont chacune leur préflight ; procédure à écrire |
| P30 | Retour arrière éprouvé | IN_PROGRESS | — |
| P31 | Performance non régressée (p95 < 500 ms, 0 erreur) | IN_PROGRESS | à rejouer après les changements de base |
| P32 | Endurance sans fuite | IN_PROGRESS | — |
| P33 | Déploiement et recette sur staging | BLOCKED_EXTERNAL | aucune cible désignée |
| P34 | Déploiement et recette de production | BLOCKED_EXTERNAL | aucune cible désignée |

**PASS : 21 / 34. IN_PROGRESS : 11. BLOCKED_EXTERNAL : 2.**

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

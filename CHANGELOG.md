# Changelog

## [v1.0.0-rc1] — Mise en service — 2026-08-30

Campagne de durcissement avant première mise en production. Rien n'y a été
ajouté comme fonctionnalité : tout ce qui suit est ce qu'une exécution réelle a
révélé de cassé, et ce qu'il a fallu pour pouvoir l'affirmer.

### Corrections critiques

**Le champ de saisie mathématique ne transmettait rien.** `MathInput` existait
sans être utilisé nulle part. Une fois branché, trois défauts apparaissent :
React affectait `el.value` avant que MathLive n'ait défini le composant, ce qui
masquait définitivement l'accesseur du prototype — la réponse de l'élève
n'atteignait jamais le serveur ; les polices étaient cherchées dans un
répertoire jamais servi, en développement comme en production ; et la
normalisation ignorait les opérateurs produits par l'éditeur.

**Des réponses justes étaient comptées fausses.** `\frac12` — ce qu'écrit
exactement la frappe « 1/2 », donc la fraction la plus courante — traversait la
normalisation intacte et mathjs la refusait. `Infinity` devenait `infinity` au
passage en minuscules : toute limite infinie était fausse. `\log(10)` était
disloqué en `log(1)0*(10)`. Le mode de correction « exact » comparait la
réponse à la chaîne vide. Les comparateurs de fraction et de valeur numérique
ré-analysaient le texte brut au lieu de passer par la normalisation commune.

**Une réponse valant l'infini était acceptée comme égale à n'importe quoi.** La
tolérance, calculée relativement à la plus grande des deux valeurs, devenait
infinie : « 1/0 » rapportait tous les points sur toute question symbolique.

**Le crédit partiel était arrondi en base.** `responses.score` était un entier
alors que le moteur produit des quarts de point : 1,5 était stocké 2. Colonnes
passées en décimal, conversion faite à la frontière de l'API.

**N'importe quel enseignant accédait aux copies de tous les autres.** Les
routes vérifiaient l'authentification, jamais la propriété : à partir d'un
simple identifiant, on pouvait lire, recorriger, modifier une note, forcer une
remise et consulter le journal d'audit d'un collègue.

**Les secrets de session avaient une valeur par défaut publiée dans ce dépôt.**
Une production qui les oubliait signait ses cookies enseignant avec une chaîne
lisible dans le code source. Le démarrage refuse désormais ces valeurs, les
motifs de remplissage, et deux secrets identiques.

**La surveillance anti-triche était inopérante.** Le battement de présence
lisait un en-tête que personne n'émettait. Le balayage d'inactivité ne tournait
jamais de lui-même : le seuil des 180 secondes ne tenait que si un autre élève
émettait un signal. Le score de suspicion était calculé avant l'inscription de
la déconnexion, si bien qu'une copie abandonnée ressortait « Propre ».

**Le bundle de production ne démarrait pas** — collision de noms entre le
préambule esbuild et pdfkit, invisible en développement qui passe par Vite. La
procédure de migration documentée était inapplicable, `drizzle-kit` étant
retiré de l'image ; un migrateur est désormais livré dans le bundle.
**L'impression était impossible dans le déploiement documenté** : le volume des
sujets appartenait à root alors que le processus tourne non privilégié.

**Un rechargement de page perdait la copie en cours.** Le jeton ne vivait qu'en
mémoire et les brouillons enregistrés côté serveur n'étaient jamais relus. Sur
un réseau qui pend plutôt que de couper — portail captif, borne saturée — la
sauvegarde restait bloquée indéfiniment sans rien mettre en file locale.

**Une copie pouvait porter deux réponses à la même question.** Contrainte
d'unicité posée sur `(sessionId, questionId)` ; la migration échoue plutôt que
de supprimer une réponse. Deux remises simultanées remontaient une erreur SQL
brute jusqu'à l'élève : la copie est désormais prise en un ordre atomique.

### Ce qui a été ajouté pour pouvoir l'affirmer

- Écran de correction copie par copie, journal d'audit des interventions
  (ajout seul, auteur, avant/après, motif, identifiant de requête), relevé de
  notes en PDF et en tableur, tableau de bord recentré sur l'atelier papier.
- Champ mathématique adapté au mode de correction : clavier mathématique pour
  les comparaisons numériques, clavier ordinaire pour une comparaison textuelle.
- 805 tests, dont un socle d'intégration sur base réelle ; couverture 100 % sur
  `api/grading`, 85 % globale, seuils inscrits et vérifiés en CI.
- 39 scénarios navigateur sur Chromium, Firefox et WebKit, exécutés contre le
  build de production — deux débordements d'affichage n'apparaissaient pas
  autrement.
- Recette Docker en 27 étapes sur le runtime de production, génération AMC
  réelle comprise ; recettes de scores décimaux, de typographie du relevé,
  d'export tableur, de cloisonnement entre enseignants et de seuils anti-triche
  aux constantes réelles.

### Performance

Le profilage montre que le moteur de correction n'était pas en cause : sept
pour cent du temps. Les écritures partaient une par une, la remise relisait
chaque réponse avant de l'écrire, et le pool de connexions valait dix — la
valeur par défaut du pilote, jamais écrite.

| | Avant | Après |
|---|---|---|
| Requêtes SQL par remise | 82 | 25 |
| Correction d'une copie | 165 ms | 34 ms |
| p95 de la remise, 200 élèves | 6,73 s | 2,09 s |

Critère de charge : deux cents élèves concurrents, p95 global de 36,0 / 35,6 /
39,7 ms sur trois campagnes consécutives, zéro erreur. `DB_POOL_SIZE` est
configurable ; la valeur 60 est un optimum de banc, à remesurer sur
l'infrastructure de déploiement.

### État

23 critères d'acceptation sur 23. Fusion dans `main` par commit de fusion
(PR #1), CI verte sur `f0922fc`.

`v1.0.0-rc1` atteste que le logiciel est prêt à être déployé — pas qu'il l'a
été. Le gate de production reste entier : infrastructure désignée, secrets
réels, OAuth réel, DNS et TLS, sauvegarde et restauration éprouvée, contrôle
préalable de migration, benchmark de capacité sur la cible, chaîne AMC sur la
production, smoke complet et retour arrière prêt.

### Migrations

- `0003_decimal_scores` — scores en décimal.
- `0004_grade_audit` — journal des interventions sur les notes.
- `0005_unicite_reponses` — unicité `(sessionId, questionId)`, **fermée par
  défaut** : une base contenant des doublons fait échouer la migration plutôt
  que de perdre une réponse. La réparation est un script séparé, à lancer
  délibérément, qui refuse les doublons divergents.

## [v0.4.0-atelier-qcm] — Phase 4 : atelier QCM enseignant

L'application devient ce qu'elle devait être : un atelier où l'enseignant
**rédige** ses QCM, les **imprime**, **saisit** les copies papier et obtient
les notes. Le parcours en ligne des phases précédentes est conservé.

### Ce qu'on ne réécrit pas
`auto-multiple-choice` fait déjà la mise en page LaTeX des mathématiques, les
feuilles-réponses avec cases de calage et la numérotation des copies.
L'application le pilote, elle ne le remplace pas. La séquence reprend celle de
`QCM_EDS_MATHS_TERM/prepare_korrigo.sh`.

### Lot 0 — Rendre le projet exécutable
- **`docker-compose.dev.yml`** : MySQL 8.4 sur 127.0.0.1:3307.
- **Migration de référence** : `db/migrations/` ne contenait que des `ALTER`
  sans journal — aucune base ne pouvait être créée depuis le dépôt. Baseline
  régénérée depuis `db/schema.ts`, anciens fichiers dans `legacy/`.
- **Contraintes déclarées à la source** : les quatre clés étrangères et la clé
  primaire composite d'`answer_drafts` n'existaient que dans le SQL manuel.
- **`scripts/smoke-parcours-eleve.ts`** : 22 vérifications HTTP du parcours élève.

### Lot A — Modèle de données
- `classes`, `students`, `paper_exams`, `paper_copies`.
- `evaluations.deliveryMode` (`online` / `paper` / `both`), `ownerId`, `subject`, `level`.
- **`sessions.mode`** : une copie papier est saisie dans l'ordre imprimé, une
  copie en ligne dans l'ordre mélangé. Le mode est explicite plutôt que déduit
  de la présence d'une graine — et **les deux sont notées par le même moteur**.
- **Correction d'un QCM auto-soumis** : `auto-submit` ne reconvertissait pas
  l'index mélangé, tous les QCM valaient 0.

### Lot B — Interface de rédaction
- `authoring-router.ts` : CRUD évaluations et questions, réordonnancement, duplication.
- **`contracts/question-coherence.ts`** : une question porte deux descriptions
  de sa bonne réponse — `correctAnswer` et `gradingRubric.mode` — et seule la
  rubric est consultée par le moteur. Une divergence s'enregistrait sans erreur
  et notait faux en silence. L'écriture est désormais refusée, avec le motif.
- Pages `/teacher/evaluations` et `/teacher/evaluations/:id` : aperçu KaTeX en
  direct, éditeur QCM avec **diagnostic par distracteur**.
- **Retour diagnostique branché sur la correction** : l'élève qui coche un
  distracteur documenté lit l'erreur type commise, plus « Réponse incorrecte ».
- **Correctif Tailwind** : les composants shadcn étaient écrits en syntaxe v4
  (`w-(--sidebar-width)`) sous Tailwind 3.4, qui les ignore. La gouttière de la
  barre latérale faisait 0 px et le contenu passait dessous — sur le tableau de
  bord aussi, depuis toujours. 30 classes converties dans 10 composants.

### Lot C — Assistance LLM (OpenRouter)
- **`api/llm/chat.ts`** : transport partagé correction/génération, en-têtes
  OpenRouter, repli si `response_format` est refusé.
- **Troncature détectée** via `finish_reason` : un modèle à raisonnement
  consomme le budget avant d'écrire (mesuré jusqu'à 3 460 jetons de raisonnement
  pour une seule question difficile). La coupure remontait sous la forme
  trompeuse d'un « JSON invalide ».
- **Garde-temps corrigé** : il était annulé dès la réception des en-têtes, donc
  ne couvrait pas la lecture du corps — seule partie réellement longue.
- **Prompt à distracteurs diagnostiques**, repris de `generateur_qcm.md` :
  chaque mauvaise réponse correspond à une erreur type documentée et renvoie
  vers une méthode. Distracteur fantaisiste et double capacité interdits.
- Schéma **strict sur ce qui décide de la note**, tolérant ailleurs : une
  difficulté hors barème ou un diagnostic trop long ne font plus perdre un lot.
- **Rien n'entre en base sans l'enseignant** : la route retourne des
  propositions, l'enregistrement repasse par les contrôles de cohérence.

### Lot D — Port RAG
- `RagProvider` avec `NullRagProvider` (défaut) et `HttpRagProvider`.
- Le service `nexusrag` ne démarre pas et son `/search/v2` exige une identité
  signée avec périmètre : le port permet de le brancher plus tard sans lier la
  génération à son indisponibilité.
- **Une panne du RAG ne bloque jamais la rédaction** — elle la prive d'ancrage.

### Lot E — Impression AMC
- **Aucun mélange** : le sujet est identique pour tous. Avec mélange, ni le
  numéro de question ni la lettre ne désignent la même chose d'une copie à
  l'autre, et la saisie manuelle devient ininterprétable.
- Énoncés insérés tels quels (les échapper casserait les formules), mais
  **primitives d'exécution refusées** (`\write18`, `\input`…) : compiler du
  LaTeX arbitraire côté serveur est une exécution de code.
- `GET /api/paper/:id/:file` : rôle vérifié, propriété vérifiée, noms de
  fichiers en liste fermée — traversée de répertoire impossible.

### Lot F — Saisie manuelle et notation
- Page `/teacher/saisie/:examId` : un élève à la fois, **tout au clavier**.
- **Conversion des lettres** : A → « true » pour les vrai/faux. Sans elle,
  l'index brut n'était pas reconnu et la question comptait fausse.
- **Composition figée au tirage** (`printedQuestionIds`) : la grille reflète le
  papier, pas l'état courant des questions.
- **Barème restreint aux questions imprimées** : le barème de l'évaluation
  entière était retenu, donc une copie parfaite plafonnait à 13,5/20 — les
  réponses rédigées, corrigées à part, étaient comptées perdues d'office.
- **Boucle infinie corrigée dans `MathLatex`** : un `$` non apparié faisait
  tourner le parseur sans jamais avancer, figeant la page entière.
- **Notation des questions rédigées** : elles ne figurent pas sur la
  feuille-réponses, mais se notent à la main depuis la grille ; leur barème
  s'ajoute à celui de la feuille. Sans cela, un tiers des points de
  l'évaluation de référence restait inatteignable.
- **Notes manuelles préservées** : `gradeSessionResponses` réécrivait toutes
  les réponses, effaçant en silence les points attribués par l'enseignant —
  y compris ceux d'`overrideGrade`, bug antérieur à cette phase.
- Export CSV : BOM, point-virgule, virgule décimale — lisible par Excel FR.

### Qualité
- **384 tests** verts (30 fichiers, +104 depuis la v0.3.5).
- Trois scripts de vérification contre un serveur réel :
  `smoke-parcours-eleve.ts`, `smoke-atelier-enseignant.ts`, `smoke-chaine-papier.ts`.
- `scripts/dev-session.ts` : session enseignant locale, l'OAuth Kimi étant
  indisponible hors production.

### Limites connues
- Pas d'anti-copiage par permutation (conséquence assumée de la saisie manuelle).
- Le reste de l'interface (connexion, en-tête) est toujours en anglais.

---

## [v0.3.5-convergence] — Phase 3.5 : convergence front / back

Les Phases 1 à 3 avaient durci le backend, mais le frontend élève n'avait
jamais été rebranché dessus : il appelait encore les routes de la Phase 0.
Toute la sécurité construite était contournée à l'exécution, et le moteur de
correction de la Phase 2 ne tournait jamais.

### Failles corrigées
- **`correctAnswer` servie au navigateur** — `Evaluation.tsx` chargeait les
  énoncés via `evaluation.getQuestions` (`publicQuery`, `SELECT *`). La page
  passe désormais par `question.getForActiveSession`, protégée par jeton et
  dont le select exclut explicitement la correction. *(critère go-live 1)*
- **Soumission sans jeton ni contrôle d'expiration** — `evaluation.submitAnswers`
  acceptait un `sessionId` en clair et corrigeait naïvement. Remplacée par
  `session.submit` (`studentQuery`), qui vérifie le jeton, l'expiration
  serveur, et n'accepte que les questions de l'évaluation de la session.
  *(critères 2, 3, 4)*
- **Résultats de n'importe quel élève lisibles** — `evaluation.getResults`
  prenait un `sessionId` en `publicQuery`. Remplacée par `session.getResults`,
  qui exige le jeton de résultats à durée courte émis à la soumission.
- **Statut décidé par le client** — `evaluation.updateSession` laissait le
  navigateur choisir `completed` / `cheating_detected`. Le statut et le score
  de suspicion sont maintenant calculés serveur depuis `cheat_events`.
- **Session orpheline** — `Home.tsx` ouvrait une session via
  `evaluation.createSession`, puis `Evaluation.tsx` en ouvrait une seconde via
  `session.start`. La première n'existe plus ; l'accueil ne fait que naviguer.
- **Pipeline anti-triche inerte** — `useHeartbeat`, `useAutoSave` et
  `useCheatBuffer` utilisaient le client tRPC par défaut, qui n'envoie pas
  `x-student-session-token`. Les trois routes `studentQuery` correspondantes
  répondaient donc `UNAUTHORIZED` à chaque appel. Les hooks passent désormais
  par `studentTrpc`.
- **QCM auto-soumis toujours comptés faux** — `auto-submit.ts` ne reconvertissait
  pas l'index soumis (ordre mélangé) en index d'origine : `gradeResponse`
  répondait « Index QCM manquant » et attribuait 0. Corrigé.
- **`init` détruisait la correction** — l'ancien `evaluation.init` supprimait
  puis réinsérait les questions sans leur `gradingRubric`, rendant toute
  correction impossible. Remplacé par `evaluation.seed`, upsert idempotent
  partagé avec le script `db/seed.ts`.

### Architecture
- **`api/grading/grade-session.ts`** _(nouveau)_ : moteur de correction de
  session, source de vérité unique pour `session.submit`, `grading2.gradeSession`
  et `auto-submit`. Trois implémentations divergentes corrigeaient auparavant la
  même copie de trois façons différentes.
- **`optionShuffleSeed()`** : graine de mélange des options partagée entre
  l'affichage (`question.getForActiveSession`) et la correction. La divergence
  de graine était le risque principal sur la note des QCM.
- **`api/routers/evaluation-router.ts`** _(nouveau)_ : `listPublic` (catalogue
  élève, champs publics), `listForTeacher`, `seed`. Remplace
  `api/evaluation-router.ts`, **supprimé**.
- **`api/grading-router.ts` supprimé** : ancien correcteur à prompt texte
  (`SCORE:` / `FEEDBACK:`), doublon de `routers/grading-router.ts`.
- **`db/seed-evaluation.ts`** : logique d'upsert extraite du script CLI.
- **`src/providers/student-trpc.ts`** et **`student-session.ts`** : client élève
  et contexte extraits du fichier composant ; le jeton vit dans un porte-jeton
  hors React, lu par le lien HTTP à chaque requête.
- `question.getPublicInfo` calcule le barème depuis les questions en base au
  lieu de la constante `MAX_SCORE`, valable pour la seule évaluation de référence.
- Le cache react-query élève est vidé à chaque nouvelle session : les requêtes
  sans entrée partagent sinon la même clé d'une session à l'autre.

### Qualité
- **Chaîne verte** : `check` (2 erreurs TS corrigées), `lint` (13 erreurs :
  refs lues pendant le rendu, `setState` synchrone dans un effet, mémoïsations
  cassées), `test`, `build`.
- **280 tests** verts (22 fichiers, +25) :
  - `api/__tests__/security/public-surface.spec.ts` — inventaire figé des
    procédures montées, et vérification que chaque route élève ou enseignant
    rejette un appel anonyme avant d'atteindre la base.
  - `api/grading/__tests__/grade-session.spec.ts` — aller-retour affichage →
    correction de l'index QCM, et entrées non corrigeables.
- `.env.example` complété : secrets de session, clé LLM, `ALLOWED_ORIGINS`.

---

## [v0.3.0-anticheat] — Phase 3 : Anti-triche professionnel

### Bloc A — Fondations
- **0003_anticheat.sql** : sessions (ipAddress, userAgent, fingerprintHash, suspicionScore, suspicionVerdict, auto_submitted_idle status), table `answer_drafts` (PK composite, FK cascade, audit trail committedAt), cheat_events enum +idle_disconnect +window_size_anomaly
- **db/schema.ts** : champs Phase 3 sur sessions, `answerDrafts` table, `CheatEventType` export, DEPRECATED note sur `cheatEvents` JSON
- **idb-keyval@6.2.2** ajouté (queue offline)
- **contracts/anticheat-config.ts** : EVENT_WEIGHTS, VERDICT_THRESHOLDS, seuils idle (60s warn, 180s auto-submit)
- **contracts/fingerprint-canonical.ts** : FingerprintComponentsSchema + `serializeCanonical` partagé client/serveur

### Bloc B — Modules anti-triche purs (50 tests)
- **api/anticheat/fingerprint.ts** : `computeFingerprintHash` SHA-256 déterministe, `compareFingerprints` mode strict
- **api/anticheat/score-suspicion.ts** : `computeSuspicionScore` — Σ min(cap, count×unit) plafonné 100, 4 verdicts pédagogiques
- **api/anticheat/event-aggregator.ts** : `ingestEvents` — déduplication fenêtre 500ms par (sessionId, type)

### Bloc C — Heartbeat + idle sweeper + auto-submit (21 tests)
- **api/anticheat/heartbeat.ts** : `processHeartbeat` — refresh lastHeartbeatAt, détection fingerprint/IP mismatch, remainingMs autoritatif
- **api/anticheat/auto-submit.ts** : drafts → responses skipLLM=true, suspicion finale, normalizedScore /20 arrondi au quart de point
- **api/anticheat/idle-sweeper.ts** : `runIdleSweep` — warn @60s, auto-submit @180s
- **api/grading/grade-response.ts** : `skipLLM` param + `GradingResult.needsLLM` — jamais d'appel LLM en auto-submit

### Bloc D — Routers
- **session-router.ts** : `start` ingère fingerprintHash + ipAddress + userAgent ; `heartbeat` Phase 3 via `processHeartbeat` + mismatch events + idle-sweeper fire-and-forget
- **answer-router.ts** : `saveDraft` (upsert answer_drafts) + `listDrafts`
- **cheat-router.ts** : `reportBatch` via `ingestEvents` (déduplication) + Phase 3 event types
- **teacher-live-router.ts** _(nouveau)_ : `snapshot` (polling 5s) + `forceSubmit` (teacherQuery)

### Bloc E — Hooks frontend
- **src/lib/idb-queue.ts** : FIFO IndexedDB avec dégradation mémoire (Safari private)
- **src/hooks/useFingerprint.ts** : canvas hash + WebGL + `serializeCanonical` côté client (Web Crypto)
- **src/hooks/useHeartbeat.ts** : poll 15s, cancelRef, ticker 1s, callbacks mismatch/expiration
- **src/hooks/useCheatBuffer.ts** : coalescing + flush 5s, retry on failure, beforeunload
- **src/hooks/useAutoSave.ts** : debounce 2s + IDB queue retry 5s, status idle/saving/saved/error/offline
- **src/hooks/useAntiCheat.ts** : refactorisé — délègue à `useCheatBuffer`, `sessionToken` requis

### Bloc F — Composants UI
- **FullscreenGuard** : overlay bloquant aria-modal, `requestFullscreen` auto
- **AutoSaveIndicator** : aria-live statuts avec icônes Lucide
- **HeartbeatStatus** : Wifi icon + remainingMs formaté MM:SS
- **CheatBanner** : aria-live=assertive, auto-dismiss 5s
- **DevToolsDetector** : window size + performance.now debugger trap
- **SuspicionBadge** / **LiveSessionRow** / **LiveDashboard** : tableau temps-réel enseignant (polling 5s), forceSubmit

### Bloc G — Qualité
- **api/anticheat coverage** : 100% funcs, ~95% stmts (heartbeat 100%, event-aggregator 100%, fingerprint 100%, idle-sweeper 100%)
- **255 tests** verts (20 fichiers)
- **DEPRECATED** : `sessions.cheatEvents` JSON — ne plus écrire ; toutes les écritures supprimées en pré-flight ; drop prévu en v0.4.0

---

## [v0.2.0-grading] — Phase 2 : Moteur de correction mathématique

### Bloc B — Comparateurs de réponses (181 tests)

- **normalize.ts** : normalisation des expressions mathématiques (espaces, virgule décimale FR, Unicode, LaTeX → mathjs, multiplication implicite)
- **compare-exact.ts** : comparaison littérale après normalisation (parenthèses superflues gérées)
- **compare-numeric.ts** : comparaison numérique avec tolérance absolue ou relative (constantes π, e, √2 reconnues)
- **compare-fraction.ts** : comparaison de fractions, vérification irréductibilité, pénalité 25 % si non-réduite
- **compare-symbolic.ts** : comparaison symbolique via mathjs (stratégies : littérale → simplification → test numérique)
- **compare-set.ts** : comparaison d'ensembles ordonnés / non-ordonnés, parsing `{1;2}` / `{1,2}` / `(1,2)`
- **shuffle.ts** : mélange déterministe mulberry32 + Fisher-Yates, résolution index QCM après mélange

### Bloc C — Client LLM + orchestrateur (201 tests)

- **grading-prompt.ts** : templates système + utilisateur par type de question (QCM, RC, VF), format JSON structuré
- **llm-client.ts** : client Moonshot/OpenAI-compatible, retry × 3 avec backoff 1s/3s/9s, cache LRU 1 h / 1 000 entrées, parsing tolérant aux fences ` ```json ``` `, clampage au barème + arrondi demi-point
- **grade-response.ts** : orchestrateur en cascade (QCM → vrai/faux → RC avec acceptableForms → comparateur → LLM fallback), crédit partiel, feedback pédagogique

### Bloc D — 20 questions LaTeX + rubrics pédagogiques

- **evaluation-data.ts** : 20 questions réécrites en LaTeX (`$...$`, `\mathrm`, `\mathbb`, `\mathcal`, etc.)
  - Rubrics complètes : `gradingRubric`, `tags`, `difficulty` pour chaque question
  - Corrections pédagogiques : TVI (intervalle ouvert `]a;b[`), VF19 (`a < b` précisé), VF20 (variance vs espérance)
- **types.ts** : extension `EvaluationQuestion` avec `gradingRubric?`, `tags?`, `difficulty?`, `imageUrl?`
- **seed.ts** : seed idempotent par upsert `(evaluationId, order)`, log créé / mis à jour

### Bloc E — Routers API

- **answer-router.ts** : `save` (upsert réponse élève), `getSaved` (reprise de session) — student-only
- **grading-router.ts** (Phase 2) : `gradeSession`, `getResults`, `overrideGrade` — teacher-only
  - Résolution mapping shuffle QCM côté serveur
  - Cascade de correction + stockage `gradingMode`, `llmConfidence`, `partialCreditApplied`, `normalizedScore`
- **question-router.ts** : `seededShuffle` → `shuffleDeterministic` (mulberry32 partagé)

### Bloc F — Composants frontend mathématiques

- **MathLatex.tsx** : rendu KaTeX (modes inline / display / auto avec parsing `$...$` et `$$...$$`), gestion d'erreur gracieuse
- **MathInput.tsx** : champ de saisie MathLive (web component), import lazy, valeur contrôlée, accessibilité ARIA
- **MathPalette.tsx** : palette de symboles groupés (fractions, exposants, fonctions, ensembles, intégrales)

### État

23 critères d'acceptation sur 23. Fusion dans `main` par commit de fusion
(PR #1), CI verte sur `f0922fc`.

`v1.0.0-rc1` atteste que le logiciel est prêt à être déployé — pas qu'il l'a
été. Le gate de production reste entier : infrastructure désignée, secrets
réels, OAuth réel, DNS et TLS, sauvegarde et restauration éprouvée, contrôle
préalable de migration, benchmark de capacité sur la cible, chaîne AMC sur la
production, smoke complet et retour arrière prêt.

### Migrations DB (Phase 2)

- **0002_grading_rubric.sql** : `gradingRubric` JSON + `tags` + `difficulty` sur `questions` ; `normalizedScore` DECIMAL(5,2) sur `sessions` ; `gradingMode`, `llmConfidence`, `gradingReason`, `partialCreditApplied` sur `responses`

---

## [Phase 1] — Sécurité, anti-triche, rôles

- Séparation rôles student / teacher / admin
- Timer serveur-autoritatif, tokens JWT séparés, CSRF, rate-limiting
- Table `cheat_events` append-only
- Mélange déterministe questions + options QCM
- 181 tests sécurité, session, QCM

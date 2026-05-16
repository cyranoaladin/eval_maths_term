# Changelog

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

### Migrations DB (Phase 2)

- **0002_grading_rubric.sql** : `gradingRubric` JSON + `tags` + `difficulty` sur `questions` ; `normalizedScore` DECIMAL(5,2) sur `sessions` ; `gradingMode`, `llmConfidence`, `gradingReason`, `partialCreditApplied` sur `responses`

---

## [Phase 1] — Sécurité, anti-triche, rôles

- Séparation rôles student / teacher / admin
- Timer serveur-autoritatif, tokens JWT séparés, CSRF, rate-limiting
- Table `cheat_events` append-only
- Mélange déterministe questions + options QCM
- 181 tests sécurité, session, QCM

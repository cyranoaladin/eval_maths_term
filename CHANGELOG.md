# Changelog

## [Unreleased] — Phase 2 : Moteur de correction mathématique

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

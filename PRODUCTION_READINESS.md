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
| Dernière mise à jour | 2026-08-30 — audit initial |

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
| P1 | 0 suppression de type, 0 suppression de linter, 0 test ignoré | IN_PROGRESS | — |
| P2 | 0 identifiant codé en dur, 0 secret de développement versionné | IN_PROGRESS | — |
| P3 | Une seule source de configuration, parité prouvée | IN_PROGRESS | — |
| P4 | Identité produit et version exposées, SHA injecté au build | IN_PROGRESS | — |
| P5 | 0 double source de vérité (`correctAnswer` / `gradingRubric`) | IN_PROGRESS | — |
| P6 | 0 dette anti-triche (`sessions.cheatEvents`, `tabSwitchCount`, `cheat.report`) | IN_PROGRESS | — |
| P7 | 0 route orpheline | IN_PROGRESS | — |
| P8 | Invariants d'intégrité des 13 tables, contraintes en base | IN_PROGRESS | — |
| P9 | Provisionnement enseignant explicite, aucun accès automatique | IN_PROGRESS | — |
| P10 | OAuth durci — `PUBLIC_BASE_URL`, cookie `Secure`, validation du jeton | IN_PROGRESS | — |
| P11 | En-têtes de sécurité HTTP, CSP sans `unsafe-eval` | IN_PROGRESS | — |
| P12 | Analyse de secrets dans notre CI | IN_PROGRESS | — |
| P13 | Chaîne d'approvisionnement — 0 vulnérabilité HIGH/CRITICAL, SBOM | IN_PROGRESS | — |
| P14 | Build reproductible, images épinglées par empreinte | IN_PROGRESS | — |
| P15 | Une seule image canonique de production, avec impression | IN_PROGRESS | — |
| P16 | Vivacité et disponibilité distinctes et réelles | IN_PROGRESS | — |
| P17 | Arrêt gracieux | IN_PROGRESS | — |
| P18 | Contre-pression, remise idempotente | IN_PROGRESS | — |
| P19 | Observabilité — 0 `console.*`, supervision d'erreurs | IN_PROGRESS | — |
| P20 | CI : tests navigateur obligatoires, aucun job tolérant l'échec | IN_PROGRESS | — |
| P21 | 0 test en échec, 0 ignoré, 0 instable (0 reprise) | IN_PROGRESS | — |
| P22 | Couverture : 100 % sur les domaines critiques, ≥ 95 % global serveur | IN_PROGRESS | — |
| P23 | Accessibilité — 0 violation critique ou sérieuse | IN_PROGRESS | — |
| P24 | Régression visuelle sur les écrans critiques | IN_PROGRESS | — |
| P25 | Aucune erreur navigateur inattendue tolérée | IN_PROGRESS | — |
| P26 | 0 code mort, 0 dépendance inutilisée, 0 duplication métier | IN_PROGRESS | — |
| P27 | `main` protégée, tags protégés | IN_PROGRESS | — |
| P28 | Sauvegarde et restauration éprouvées | IN_PROGRESS | — |
| P29 | Migration de production : sauvegarde → préflight → migration → postflight | IN_PROGRESS | — |
| P30 | Retour arrière éprouvé | IN_PROGRESS | — |
| P31 | Performance non régressée (p95 < 500 ms, 0 erreur) | IN_PROGRESS | — |
| P32 | Endurance sans fuite | IN_PROGRESS | — |
| P33 | Déploiement et recette sur staging | BLOCKED_EXTERNAL | aucune cible désignée |
| P34 | Déploiement et recette de production | BLOCKED_EXTERNAL | aucune cible désignée |

**PASS : 0 / 34. IN_PROGRESS : 32. BLOCKED_EXTERNAL : 2.**

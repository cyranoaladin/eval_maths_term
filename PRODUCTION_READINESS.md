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
| P8 | Invariants d'intégrité des 13 tables, contraintes en base | IN_PROGRESS | — |
| P9 | Provisionnement enseignant explicite, aucun accès automatique | **PASS** | migration 0006 + `acces-comptes.integration.spec.ts` (11 cas sur la vraie base) |
| P10 | OAuth durci — `PUBLIC_BASE_URL`, cookie `Secure`, validation du jeton | **PASS** | `api/__tests__/security/oauth-durcissement.spec.ts` — 18 cas |
| P11 | En-têtes de sécurité HTTP, CSP sans `unsafe-eval` | **PASS** | `surface-http.integration.spec.ts` sur du vrai HTTP + 39 parcours sur le build de production, trois moteurs |
| P12 | Analyse de secrets dans notre CI | IN_PROGRESS | — |
| P13 | Chaîne d'approvisionnement — 0 vulnérabilité HIGH/CRITICAL, SBOM | IN_PROGRESS | `npm audit` : 0 vulnérabilité, production et développement. SBOM et scan d'image restants |
| P14 | Build reproductible, images épinglées par empreinte | IN_PROGRESS | — |
| P15 | Une seule image canonique de production, avec impression | IN_PROGRESS | — |
| P16 | Vivacité et disponibilité distinctes et réelles | **PASS** | `/api/health` et `/api/ready` ; 4 vérifications HTTP dans `surface-http.integration.spec.ts` ; le conteneur interroge la disponibilité |
| P17 | Arrêt gracieux | **PASS** | `scripts/smoke-arret-gracieux.ts` : SIGTERM pendant une remise en vol, copie entière, sortie 0 ; 4 tests unitaires sur l'ordre |
| P18 | Contre-pression, remise idempotente | IN_PROGRESS | — |
| P19 | Observabilité — 0 `console.*`, supervision d'erreurs | IN_PROGRESS | `journalisation.spec.ts` : 0 appel direct. Supervision non branchée |
| P20 | CI : tests navigateur obligatoires, aucun job tolérant l'échec | IN_PROGRESS | identifiants éphémères faits ; matrice de jobs à faire |
| P21 | 0 test en échec, 0 ignoré, 0 instable (0 reprise) | IN_PROGRESS | 857 tests, 39 parcours ; `fileParallelism: false` rétabli (l'option était ignorée depuis Vitest 4) |
| P22 | Couverture : 100 % sur les domaines critiques, ≥ 95 % global serveur | IN_PROGRESS | seuils actuels : 100 % sur `api/grading`, 80 % global |
| P23 | Accessibilité — 0 violation critique ou sérieuse | IN_PROGRESS | — |
| P24 | Régression visuelle sur les écrans critiques | IN_PROGRESS | — |
| P25 | Aucune erreur navigateur inattendue tolérée | IN_PROGRESS | `collecterErreurs` en place ; à généraliser |
| P26 | 0 code mort, 0 dépendance inutilisée, 0 duplication métier | **PASS** | `knip` ne signale plus rien ; `jscpd` 1,34 % — voir §4 |
| P27 | `main` protégée, tags protégés | IN_PROGRESS | — |
| P28 | Sauvegarde et restauration éprouvées | IN_PROGRESS | — |
| P29 | Migration de production : sauvegarde → préflight → migration → postflight | IN_PROGRESS | 0006 et 0007 ont chacune leur préflight ; procédure à écrire |
| P30 | Retour arrière éprouvé | IN_PROGRESS | — |
| P31 | Performance non régressée (p95 < 500 ms, 0 erreur) | IN_PROGRESS | à rejouer après les changements de base |
| P32 | Endurance sans fuite | IN_PROGRESS | — |
| P33 | Déploiement et recette sur staging | BLOCKED_EXTERNAL | aucune cible désignée |
| P34 | Déploiement et recette de production | BLOCKED_EXTERNAL | aucune cible désignée |

**PASS : 13 / 34. IN_PROGRESS : 19. BLOCKED_EXTERNAL : 2.**

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


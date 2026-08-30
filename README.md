# Atelier QCM — Évaluation Mathématiques

> **Ce document est autosuffisant.** Il décrit le projet, sa logique métier, son
> architecture, son cahier des charges et son état exact. Il est destiné à
> permettre à un tiers de reprendre le pilotage du développement sans avoir lu
> l'historique du projet.
>
> Dernière mise à jour : après le commit `4a0b188`. Toutes les données
> chiffrées ci-dessous ont été relevées dans le code et la base, pas estimées.

---

## 1. En un coup d'œil

**Ce que fait l'application.** Un enseignant y **rédige** des QCM (assisté par
un modèle de langage s'il le souhaite), les **imprime** sous forme de sujets
nominatifs avec feuille-réponses, **saisit** au clavier les réponses lues sur
les copies papier, et obtient les **notes**. La même évaluation peut aussi être
passée **en ligne** par les élèves, avec surveillance ; les deux supports sont
corrigés par le même moteur.

**Où c'est.** `/home/alaeddine/Documents/02_Plateformes/app`
Branche : `main`, taguée `v1.0.0-rc1`.

**État.** Phases 1 à 5 terminées. `npm run check`, `npm run lint`,
**868 tests**, `npm run test:coverage` et `npm run build` sont verts, ainsi que
**39 scénarios navigateur** sur Chromium, Firefox et WebKit contre le build de
production. **Les 23 critères de mise en service sont satisfaits.**

Le dossier de preuve détaillé, critère par critère avec la commande qui
l'établit, est dans [`RELEASE_EVIDENCE.md`](RELEASE_EVIDENCE.md).

**Démarrer.**
```bash
cd /home/alaeddine/Documents/02_Plateformes/app
npm install
scripts/bootstrap-dev.sh                           # .env, secrets tirés localement
docker compose -f docker-compose.dev.yml up -d     # MySQL sur 127.0.0.1:3307
npx tsx db/migrate.ts && npx tsx db/seed.ts
npx tsx scripts/dev-session.ts                     # session enseignant locale (autorisée d'office)
npx tsx scripts/fixtures-e2e.ts                    # classe, élèves et tirage de démonstration
npm run dev                                        # http://localhost:3000
npx tsx scripts/dev-session.ts                     # session enseignant locale (autorisée d'office)
```

---

## 2. Origine et problème métier

L'utilisateur est **professeur agrégé de mathématiques** au Lycée Pierre Mendès
France (Tunis, réseau AEFE). Il disposait déjà d'une chaîne papier fonctionnelle,
en Python et LaTeX, dans `~/Documents/01_Maths/QCM_EDS_MATHS_TERM/` :

- `QCM_Terminal_AMC.tex` — QCM écrit à la main avec le paquet LaTeX
  `automultiplechoice` (AMC), sujets et feuilles-réponses générés
- `manual_entry.html` + `manual_entry.js` + `manual_entry_server.py` (~1 000
  lignes) — interface de saisie manuelle des réponses, élève par élève
- chaîne de correction optique par scan, documentée dans
  `AMC_AUTOMATIC_CORRECTION_AUDIT.md`
- `liste_eleves.csv` — export de la vie scolaire (BOM, point-virgule,
  guillemets, colonne `Eleves` au format « NOM Prénom »)

Il manquait trois choses : **une interface de création** (le `.tex` s'écrivait à
la main), **l'assistance d'un modèle de langage**, et **un RAG** pour ancrer les
questions sur ses propres supports de cours.

Ce dépôt était au départ un tout autre produit : une plateforme d'examen **en
ligne** avec anti-triche, développée sur trois phases. Le travail récent l'a
réorienté vers l'atelier décrit ci-dessus, **sans supprimer** le parcours en
ligne.

**Ce qu'on ne réécrit pas.** `auto-multiple-choice` (installé, version 1.6.0)
fait déjà la mise en page LaTeX des mathématiques, les cases de calage, la
numérotation des copies et la lecture optique. L'application le **pilote**.

---

## 3. Logique métier

### 3.1 Les objets

- Une **évaluation** porte un titre, une durée, un mode de passation
  (`online`, `paper`, `both`) et des **questions**.
- Une **question** est de type `qcm`, `true_false` ou `short_answer`. Elle porte
  un énoncé en LaTeX, un barème en points, et un **barème de correction**
  (`gradingRubric`) qui décrit comment la corriger.
- Une **classe** contient des **élèves**, importés depuis un CSV de vie scolaire.
- Un **tirage** (`paper_exam`) est une impression d'une évaluation pour une
  classe, à une date. Il fige la composition imprimée.
- Une **copie** (`paper_copy`) lie un élève à un tirage.
- Une **session** est une copie corrigée : soit une passation en ligne, soit une
  copie papier saisie. Elle porte les **réponses** et la note.

### 3.2 Le parcours enseignant (papier)

1. **Créer une évaluation** — `/teacher/evaluations`, elle naît inactive.
2. **Rédiger les questions** — `/teacher/evaluations/:id`. Éditeur avec aperçu
   LaTeX en direct. Pour un QCM : propositions, bonne réponse, et sous chaque
   distracteur un champ **erreur type**.
3. **Faire proposer** (facultatif) — un modèle rédige des questions sur un
   thème ; l'enseignant les accepte, retouche ou écarte une par une.
4. **Imprimer** — choisir une classe, importer sa liste, générer. AMC produit
   `sujet.pdf`, `corrige.pdf` et `catalog.pdf`, avec une copie nominative par
   élève et sa feuille-réponses détachable.
5. **Saisir** — `/teacher/saisie/:examId`. Un élève à la fois, tout au clavier :
   on tape la lettre, la réponse se pose, la ligne suivante s'active. Les
   questions rédigées se notent à la main dans un second bloc.
6. **Noter** — note sur 20 calculée immédiatement, moyenne de classe, export CSV.

### 3.3 Le parcours élève (en ligne)

`/` → saisie du nom → `/evaluation?eval=N&name=…` → `session.start` délivre un
jeton JWT signé → les énoncés arrivent **mélangés** selon une graine propre à la
session → composition avec auto-sauvegarde, heartbeat, plein écran et détection
d'incidents → `session.submit` → `/results?token=…`.

### 3.4 La correction

Un seul moteur, `api/grading/grade-session.ts`, corrige les deux supports.
Cascade par type :

| Type | Traitement |
|---|---|
| `qcm` | Comparaison d'index. En ligne, l'index soumis est reconverti depuis l'ordre mélangé ; sur papier, il est déjà l'index d'origine. |
| `true_false` | Valeur booléenne, tolérante à « vrai / v / oui / 1 ». Si une justification est exigée, elle passe au modèle de langage. |
| `short_answer` | Formes acceptables explicites, puis comparateur selon le mode : `exact`, `numeric` (tolérance absolue ou relative), `fraction` (avec exigence d'irréductibilité), `symbolic` (via mathjs), `set`. Repli sur le modèle si `llmReviewRequired`. |

La note sur 20 est arrondie au quart de point. Une note posée par l'enseignant
(`manual_override`, `manual_paper`) n'est **jamais recalculée**.

---

## 4. Décisions structurantes

Ces choix expliquent une grande partie du code. Les remettre en cause casserait
des invariants.

### 4.1 Le barème de correction est la seule source de vérité

Une question porte **deux** descriptions de sa bonne réponse : la colonne
héritée `questions.correctAnswer` et `gradingRubric.mode`. **Seule la seconde
est consultée par le correcteur.** Une divergence s'enregistrait sans erreur, se
relisait normalement dans l'éditeur, et notait faux en silence.

`contracts/question-coherence.ts` refuse désormais l'écriture d'une question
incohérente, et l'éditeur **dérive** `correctAnswer` du barème : la divergence
est impossible à créer depuis l'interface.

### 4.2 Les sujets papier ne sont pas mélangés

AMC sait mélanger questions et réponses, ce qui est précieux en correction par
scan — AMC connaît alors la permutation de chaque copie. Mais la chaîne visée
ici est la **saisie manuelle** : l'enseignant lit « question 3 : B ». Avec
mélange, ni le numéro ni la lettre ne désignent la même chose d'une copie à
l'autre : la saisie devient ininterprétable et chaque QCM est noté au hasard.

Le gabarit n'appelle donc jamais `\shufflegroup` et déclare `\begin{choices}[o]`.
**Contrepartie assumée : pas d'anti-copiage par permutation sur papier.**

### 4.3 `sessions.mode` rend le mélange explicite

`online` → l'index soumis doit être reconverti via la graine.
`paper` → correspondance directe.

Déduire le mode de la présence d'une graine aurait marché par accident ; le
rendre explicite empêche une copie papier d'être corrigée comme une copie en
ligne.

### 4.4 Le barème d'une copie papier se limite aux questions imprimées

Les réponses rédigées ne se cochent pas : elles ne figurent pas sur la
feuille-réponses. Si l'enseignant ne leur attribue pas de points, elles ne
comptent pas dans le barème — sinon une copie parfaite plafonnerait très en
dessous de 20.

### 4.5 Les distracteurs sont diagnostiques

Reprise de la règle du prompt `generateur_qcm.md` des manuels de l'utilisateur :
**chaque mauvaise réponse doit correspondre à une erreur type réelle et porter
un diagnostic** qui renvoie vers une méthode. Ce diagnostic est stocké dans
`gradingRubric.distractorDiagnostics` et **renvoyé à l'élève à la correction**,
à la place de « Réponse incorrecte ».

### 4.6 Le modèle de langage et le RAG sont facultatifs

Sans `LLM_API_KEY` : la rédaction reste manuelle, les réponses ouvertes sont
marquées « à corriger manuellement ». Sans `RAG_URL` : la génération perd son
ancrage documentaire, pas sa disponibilité. Une panne du RAG est absorbée.

### 4.7 Rien n'entre en base sans l'enseignant

La génération **retourne des propositions**. L'enregistrement repasse par
`createQuestion`, qui applique les mêmes contrôles qu'une saisie manuelle.

---

## 5. Architecture

### 5.1 Pile technique

| Couche | Technologie |
|---|---|
| Interface | React 19, Vite 7, TypeScript strict, Tailwind 3.4, shadcn/ui (53 composants) |
| Transport | tRPC 11 + superjson, React Query |
| Serveur | Hono 4, exécuté par `@hono/vite-dev-server` en développement, bundlé par esbuild en production |
| Base | MySQL 8.4, Drizzle ORM 0.45, migrations Drizzle Kit |
| Mathématiques | KaTeX (rendu), MathLive (saisie), mathjs (comparaison symbolique) |
| Authentification | OAuth Kimi, session JWT (`jose`) |
| Modèle de langage | API compatible OpenAI — OpenRouter par défaut |
| Impression | `auto-multiple-choice` 1.6.0 piloté en ligne de commande |
| Tests | Vitest (868 tests, dont un socle d'intégration sur base réelle), Playwright (39 scénarios, trois moteurs), neuf recettes de bout en bout, k6 |

### 5.2 Arborescence

```
api/
  boot.ts                 application Hono : CORS, OAuth, /api/health, tRPC,
                          téléchargement des documents de tirage
  router.ts               assemblage des 9 sous-routeurs
  middleware.ts           publicQuery / studentQuery / teacherQuery / adminQuery
  context.ts              contexte tRPC (req, user, studentSession)

  anticheat/              mode en ligne uniquement
    session-token.ts        JWT élève et jeton de résultats
    fingerprint.ts          empreinte navigateur SHA-256
    score-suspicion.ts      score pondéré plafonné à 100 → 4 verdicts
    event-aggregator.ts     déduplication des incidents (fenêtre 500 ms)
    heartbeat.ts            ping 15 s, détection de changement d'IP/empreinte
    idle-sweeper.ts         alerte à 60 s, soumission automatique à 180 s
    auto-submit.ts          brouillons → réponses → note

  grading/                moteur de correction — commun papier et en ligne
    grade-session.ts        SOURCE UNIQUE : corrige une session entière
    grade-response.ts       corrige une réponse (cascade par type)
    normalize.ts            normalisation des expressions mathématiques
    compare-exact|numeric|fraction|symbolic|set.ts
    shuffle.ts              mélange déterministe (mulberry32) et reconversion
    llm-client.ts           correction assistée : cache LRU, validation Zod
    grading-prompt.ts       prompt de correction

  authoring/
    generate-questions.ts   génération de QCM à distracteurs diagnostiques

  llm/chat.ts             transport partagé (OpenRouter), détection de troncature
  rag/rag-provider.ts     port de recherche documentaire (nul par défaut)

  paper/
    amc-template.ts         évaluation → LaTeX AMC, sans mélange
    amc-runner.ts           exécution des 3 commandes AMC
    paper-service.ts        production d'un tirage, création des copies
    parse-roster.ts         lecture des listes d'élèves (format vie scolaire)
    manual-entry.ts         saisie d'une copie → session → note
    student-data.ts         export RGPD et anonymisation

  routers/                surface tRPC (voir §7)
  lib/                    env (validation Zod), logger JSON, CSRF, rate limit
  kimi/                   OAuth et session enseignant
  queries/                connexion Drizzle

contracts/                partagé client / serveur
  types.ts                  types de question
  public-types.ts           ce qu'un élève a le droit de voir
  grading-rubric.ts         schéma du barème de correction (jamais exposé)
  question-coherence.ts     règles de cohérence appliquées des deux côtés
  evaluation-data.ts        évaluation de référence (20 questions)
  anticheat-config.ts       poids des incidents, seuils d'inactivité
  fingerprint-canonical.ts  sérialisation partagée de l'empreinte

db/
  schema.ts               13 tables, 20 clés étrangères
  migrations/             0000 (référence) · 0001 (atelier) · 0002 (composition)
  migrations/legacy/      historiques inapplicables, conservés comme trace
  seed-evaluation.ts      upsert idempotent
  seed.ts                 script CLI

src/
  App.tsx                 routes, chargement différé par page
  pages/                  Home, Evaluation, Results, Dashboard, Preview, Login,
                          NotFound, legal/*, teacher/*
  components/authoring/   QuestionForm, GenerationPanel
  components/paper/       PrintPanel
  components/anticheat/   FullscreenGuard, CheatBanner, DevToolsDetector…
  components/math/        MathLatex, MathInput, MathPalette
  hooks/                  useHeartbeat, useAutoSave, useCheatBuffer, useTimer…
  providers/              client tRPC public et client élève (porte-jeton)

scripts/
  dev-session.ts              session enseignant locale (dev uniquement)
  smoke-parcours-eleve.ts     22 contrôles du parcours élève
  smoke-atelier-enseignant.ts 22 contrôles de la rédaction
  smoke-chaine-papier.ts      14 contrôles de la chaîne complète
```

### 5.3 Les deux clients tRPC

Point d'architecture facile à casser :

- `src/providers/trpc-client.ts` — client **public**, envoie le cookie
  enseignant. Utilisé par les pages publiques et enseignant.
- `src/providers/student-trpc.ts` — client **élève**, ajoute l'en-tête
  `x-student-session-token`. **Toute route `studentQuery` doit passer par lui.**
  Le jeton vit dans un porte-jeton hors React, lu par le lien HTTP à chaque
  requête ; le client est créé une seule fois.

Trois hooks utilisaient le mauvais client, et tout le pipeline anti-triche
répondait `UNAUTHORIZED` en silence. C'est le piège numéro un du projet.

---

## 6. Modèle de données

13 tables, 20 clés étrangères. Les contraintes sont déclarées dans
`db/schema.ts` — pas seulement dans le SQL — pour survivre à une régénération.

### `users` (9 colonnes)
`unionId` (unique, identité OAuth), `role` ∈ `student | teacher | admin`.

### `evaluations` (10)
`title`, `description`, `duration` (minutes), `isActive`,
`deliveryMode` ∈ `online | paper | both`, `subject`, `level`,
`ownerId` → `users` (`SET NULL`).
Une évaluation naît **inactive** ; elle ne peut être activée que si elle a au
moins une question.

### `questions` (13)
`evaluationId` → `evaluations` (`CASCADE`), `type`, `question` (LaTeX),
`options` (JSON), `correctAnswer` (**hérité, non consulté par le correcteur**),
`justificationRequired`, `points`, `gradingRubric` (JSON, **jamais exposé**),
`order`, `imageUrl`, `tags`, `difficulty`.

### `sessions` (23)
Une copie corrigée, quel que soit le support.
`evaluationId` → `evaluations` (`RESTRICT`), `studentName`, `studentEmail`,
`startedAt`, `endedAt`, `expiresAt`, `status` ∈ `in_progress | completed |
timed_out | cheating_detected | auto_submitted_idle`,
**`mode` ∈ `online | paper`**, `shuffleSeed`, `totalScore`, `maxScore`,
`normalizedScore` (décimal /20), `timeSpent`, `resultsToken`,
`lastHeartbeatAt`, `suspicionScore`, `suspicionVerdict`,
et pour le mode en ligne `ipAddress`, `userAgent`, `fingerprintHash`.
`cheatEvents` (JSON) est **déprécié** : ne plus écrire, la table dédiée fait foi.

### `responses` (14)
`sessionId` → `sessions` (`CASCADE`), `questionId` → `questions` (`RESTRICT`),
`answer`, `justification`, `isCorrect`, `score`, `maxScore`, `llmFeedback`,
`gradingMode`, `llmConfidence`, `gradingReason`, `partialCreditApplied`,
`gradedAt`.
`gradingMode` vaut `qcm`, `true_false`, `exact`, `symbolic:numeric`, `fraction`,
`acceptable_form`, `llm`, `missing_rubric`, `invalid_rubric`, ou
**`manual_override` / `manual_paper`** — ces deux derniers ne sont jamais
recalculés.

### `cheat_events` (5)
Append-only. `sessionId` → `sessions` (`CASCADE`), `type` (13 valeurs),
`timestamp`, `metadata`.

### `answer_drafts` (6)
Auto-sauvegarde en ligne. Clé primaire composite `(sessionId, questionId)`.
`committedAt` non nul = archivé.

### `classes` (7)
`ownerId` → `users` (`CASCADE`), `name`, `level`, `subject`, `schoolYear`.

### `students` (8)
`classId` → `classes` (`CASCADE`), `lastName`, `firstName`, `email`,
`externalId`, `active`.
`active = false` marque un élève **anonymisé**.

### `paper_exams` (10)
Un tirage. `evaluationId` (`RESTRICT`), `classId` (`RESTRICT`),
`createdById` (`SET NULL`), `label`, `status` ∈ `draft | generated | entering |
closed`, `workdir`, `generatedAt`,
**`printedQuestionIds` (JSON)** — composition figée au tirage : la grille de
saisie reflète le papier, pas l'état courant des questions.

### `paper_copies` (7)
`paperExamId` (`CASCADE`), `studentId` (`RESTRICT`), `copyNumber`,
`sessionId` (`SET NULL`, renseigné à la saisie), `enteredAt`, `enteredById`.

---

## 7. Surface API — 45 procédures tRPC

Quatre niveaux d'accès, définis dans `api/middleware.ts` :

| Niveau | Exigence |
|---|---|
| `publicQuery` | aucune |
| `studentQuery` | en-tête `x-student-session-token` (JWT signé serveur) |
| `teacherQuery` | cookie de session + compte **autorisé** + rôle `teacher` ou `admin` |
| `adminQuery` | cookie de session + compte **autorisé** + rôle `admin` |

Être authentifié ne suffit pas : un compte créé à la première connexion arrive
« en attente » et n'ouvre rien tant qu'un administrateur ne l'a pas autorisé.
Voir SECURITY.md.

`api/__tests__/security/public-surface.spec.ts` **fige l'inventaire** : toute
procédure ajoutée fait échouer le test tant qu'elle n'y est pas inscrite
volontairement. Il vérifie aussi que chaque route élève ou enseignant rejette un
appel anonyme **avant** d'atteindre la base.

### Accessibles sans authentification (4)
```
evaluation.listPublic    session.start
session.getResults       question.getPublicInfo
```

### Authentifiées, tous rôles (2)
```
auth.me                  auth.logout
```
`session.getResults` exige un **jeton de résultats** signé, valable 10 minutes,
émis à la soumission. Sans lui, rien n'est lisible. `auth.me` reste accessible à
un compte en attente : c'est ce qui permet à l'interface de dire pourquoi elle
n'ouvre rien.

### Élève — jeton de session requis (6)
```
question.getForActiveSession   session.heartbeat   session.submit
answer.saveDraft               answer.listDrafts   cheat.report
```
L'élève n'écrit que des brouillons. Sa copie n'entre dans la table corrigée qu'à
la remise — volontaire, automatique sur inactivité, ou forcée par l'enseignant.

### Administrateur (2)
```
access.listUsers          access.setAccess
```

### Enseignant — rédaction (10)
```
authoring.listEvaluations      authoring.getEvaluation
authoring.createEvaluation     authoring.updateEvaluation
authoring.deleteEvaluation     authoring.duplicateEvaluation
authoring.createQuestion       authoring.updateQuestion
authoring.deleteQuestion       authoring.reorderQuestions
```

### Enseignant — assistance (2)
```
authoring.llmStatus            → { configured, model, ragAvailable }
authoring.generateQuestions    → propositions NON enregistrées
```

### Enseignant — papier (13)
```
paper.status              paper.listClasses      paper.createClass
paper.listStudents        paper.importStudents   paper.listExams
paper.createAndGenerate   paper.entrySheet       paper.saveEntry
paper.results             paper.overview
paper.exportStudentData   paper.anonymizeStudent
```

### Enseignant — correction et suivi (6)
```
session.getDetailsForTeacher   grading2.gradeSession
grading2.overrideGrade         grading2.auditTrail
teacherLive.snapshot           teacherLive.forceSubmit
```

**Propriété vérifiée sur chacune.** Une session appartient à l'enseignant
propriétaire de son évaluation ; une classe, un tirage et un élève à celui qui
les a créés. La règle vit dans `api/queries/ownership.ts`, en un seul endroit :
elle avait été recopiée dans l'atelier de rédaction, et deux routes hors de
l'atelier — le suivi en direct et la génération papier — ne la vérifiaient pas
du tout. Le refus est un `NOT_FOUND`, jamais un `FORBIDDEN` : il ne confirme pas
l'existence d'une copie qu'on ne possède pas.

### Route HTTP hors tRPC
`GET /api/paper/:examId/:file` — téléchargement des documents d'un tirage.
Trois protections : rôle enseignant, propriété de la classe vérifiée en base,
et nom de fichier pris dans une **liste fermée** — `sujet.pdf`, `corrige.pdf`,
`catalog.pdf`, plus `resultats.pdf` et `resultats.csv` produits à la demande.
Aucun segment de chemin ne vient de l'URL.

`GET /api/health` — état, uptime, heure serveur, **version et empreinte Git**
du binaire qui répond. Utilisé par le healthcheck du conteneur, et par
quiconque doit rattacher une anomalie à un commit précis.

---

## 8. La chaîne papier en détail

### 8.1 Génération du LaTeX — `api/paper/amc-template.ts`

Produit un document `automultiplechoice` avec `separateanswersheet`, une copie
par élève via `\csvreader` + `\onecopy{1}` + `\AMCassociation{\Eleves}`.

**Aucun mélange** : pas de `\shufflegroup`, et `\begin{choices}[o]`.

**Questions écartées de la feuille-réponses**, avec leur motif :
- `short_answer` — ne se coche pas, à corriger séparément
- QCM à moins de deux propositions
- question sans barème de correction

**Sûreté.** Les énoncés sont du LaTeX écrit par l'enseignant et sont insérés
tels quels — les échapper casserait toutes les formules. Mais compiler du LaTeX
arbitraire côté serveur est une **exécution de code** : `assertSafeLatex` refuse
`\write18`, `\immediate`, `\openout`, `\input`, `\include`, `\usepackage`,
`\catcode`, `\def`, `\csname`, `\end{document}`, `\documentclass`, en nommant la
question fautive. Les valeurs qui ne sont pas du LaTeX (titre, nom d'élève) sont
échappées par `escapeLatexText`.

### 8.2 Exécution d'AMC — `api/paper/amc-runner.ts`

Séquence relevée dans le `prepare_korrigo.sh` de l'utilisateur :

```
auto-multiple-choice prepare --mode s --prefix ./ sujet.tex   # sujet + corrigé + calage.xy
auto-multiple-choice meptex --src ./calage.xy --data ./data   # positions des cases
auto-multiple-choice prepare --mode b --data ./data sujet.tex # barème
```

Lancées par `execFile` (**sans shell**), dans un dossier par tirage.
AMC exige un dossier `sujet-data/` dérivé du nom du fichier source et **ne le
crée pas** : son absence provoque « unable to open database ».

Mesuré : 15 pages A4, 3 copies, 16 questions, **2,8 s**.

### 8.3 Saisie — `api/paper/manual-entry.ts`

Conversion des lettres lues sur la feuille :
- QCM → la lettre **est** l'index (`C` → 2), le tirage ne mélangeant rien
- Vrai/Faux → le sujet imprime toujours Vrai puis Faux, donc `A` → `"true"`,
  `B` → `"false"`. **Sans cette conversion, `gradeResponse` ne reconnaît pas
  `"0"` comme booléen et compte la question fausse.**

La copie devient une session `mode = 'paper'`, corrigée par le moteur partagé
avec `skipLLM: true`. Ressaisir remplace : les réponses précédentes sont
supprimées, pas fusionnées.

Le **périmètre de notation** vaut `printedQuestionIds` + les questions rédigées
effectivement notées.

---

## 9. Assistance par modèle de langage

### 9.1 Transport — `api/llm/chat.ts`

Partagé entre correction et génération. API compatible OpenAI ; OpenRouter par
défaut, avec les en-têtes `HTTP-Referer` et `X-Title`.

Trois pièges traités :
- `response_format: json_object` n'est pas supporté partout → un refus en 400
  déclenche une seconde tentative sans ce champ
- les modèles encadrent leur JSON de clôtures ``` → retirées avant analyse
- **troncature détectée via `finish_reason`** → `LlmTruncatedError` explicite.
  Sans cela l'erreur remonte sous la forme trompeuse d'un « JSON invalide ».

Le garde-temps couvre **tout l'échange**, lecture du corps comprise.

**Un modèle à raisonnement consomme le budget avant d'écrire** : mesuré 830
jetons de raisonnement pour deux questions faciles, **3 460 pour une seule
question difficile avec extraits de cours**. `max_tokens` étant un plafond et
non une réservation, la réserve est fixe et généreuse : `6000 + 1500 × n`.

### 9.2 Génération — `api/authoring/generate-questions.ts`

Le prompt système reprend la règle des **distracteurs diagnostiques** et pose
des interdits explicites : distracteur fantaisiste, question évaluant deux
capacités à la fois, bonne réponse repérable à sa forme.

Le schéma de sortie est **strict sur ce qui décide de la note** (énoncé,
propositions, index de la bonne réponse : une erreur y fausse la correction,
la question est écartée) et **tolérant ailleurs** (difficulté hors barème
ramenée dans les bornes, diagnostic trop long coupé) — rejeter tout un lot pour
un champ cosmétique ferait perdre une génération entière.

Chaque proposition repasse par `validateQuestionCoherence`. Une proposition
incohérente est **affichée avec ses motifs**, son bouton d'ajout direct
désactivé : elle ne peut être gardée qu'après passage par l'éditeur.

Plafond : 12 générations par tranche de 5 minutes et par enseignant.
Mesures réelles : ~30 s et ~0,02 $ pour deux questions.

### 9.3 Port RAG — `api/rag/rag-provider.ts`

Interface `search(query, k) → RagPassage[]` avec référence citable.
`NullRagProvider` par défaut ; `HttpRagProvider` vise le contrat v1
(`POST {RAG_URL}/search`, en-tête `x-api-key`, réponse de forme Chroma).

**Pourquoi un port plutôt qu'un appel direct.** Le service `nexusrag` de
l'utilisateur (source : `~/Bureau/RAG/services/rag-engine/infra`, exposé sur
`127.0.0.1:8011`) **ne démarre pas** : `RuntimeError: release manifest
unavailable or invalid` (`retrieval_v2_endpoint.py:559`). Son endpoint
`/search/v2` exige en outre une identité signée avec périmètre (niveau, voie,
matière) et des barrières « fail-closed ». Lier la génération à cette API la
rendrait indisponible en même temps que lui.

`searchContext` absorbe toute panne : la génération perd son ancrage, pas sa
disponibilité. Les sources utilisées remontent à l'enseignant.

---

## 10. Sécurité

| Menace | Traitement |
|---|---|
| Un élève cherche les corrections | `correctAnswer` et `gradingRubric` ne sortent d'aucune route élève. `question.getForActiveSession` les exclut de son `select` ; `public-types.ts` ne les déclare pas. |
| Un élève forge son score | Le client n'envoie que des réponses. Score, note, statut et suspicion sont calculés serveur. `session.submit` n'accepte que les questions de l'évaluation liée à la session. |
| Dépassement du temps | `expiresAt` fixé à la création, vérifié à chaque mutation. |
| Lecture de la copie d'autrui | Jeton de résultats signé, 10 minutes. L'ancienne route acceptait un identifiant en clair. |
| Exécution de code par le LaTeX | Primitives dangereuses refusées avant compilation ; `execFile` sans shell. |
| Traversée de répertoire | Noms de fichiers en liste fermée, propriété vérifiée. |
| Session enseignant forgée | JWT signé avec `TEACHER_SESSION_SECRET`, distinct d'`APP_SECRET`, ≥ 32 caractères, 12 h. |
| CSRF | `csrfMiddleware` vérifie `Origin` et `Referer` contre `ALLOWED_ORIGINS`. State OAuth `nanoid(32)` en cookie `HttpOnly`. |
| Épuisement | Limites en mémoire : démarrage de session, heartbeat, génération. Corps plafonné à 10 Mo. |

`scripts/dev-session.ts` fabrique une session enseignant locale. **Ce n'est pas
un contournement** : il exige `TEACHER_SESSION_SECRET`, qu'aucune route ne
délivre, et refuse de s'exécuter en production.

### RGPD

- `/mentions-legales` et `/confidentialite`. Les coordonnées viennent de
  variables `VITE_*` ; **si elles manquent, la page l'affiche** et nomme les
  variables — plutôt que d'inventer un éditeur.
- `paper.exportStudentData` — droit d'accès : identité, copies, sessions,
  réponses, incidents. Téléchargeable en JSON.
- `paper.anonymizeStudent` — droit à l'effacement **par anonymisation** :
  supprimer emporterait des notes d'évaluations rendues, que l'établissement
  doit conserver. Identité remplacée par un pseudonyme stable ; adresse, IP,
  empreinte et agent effacés ; résultats conservés. Idempotent.
- Les sessions en ligne ne sont pas liées à la fiche élève : le rapprochement se
  fait **par nom**, ce que l'export indique explicitement.
- **Aucun nom d'élève n'est transmis au modèle de langage.** La correction
  assistée envoie la réponse rédigée, sans identité ; la génération de questions
  porte sur un thème.

---

## 11. Configuration

`api/lib/env.ts` valide tout au démarrage par Zod et **refuse de démarrer** si
une variable requise manque ou est trop courte.

| Variable | Requis | Défaut | Rôle |
|---|---|---|---|
| `APP_ID` | oui | — | Application OAuth |
| `APP_SECRET` | oui (≥32) | — | Signature OAuth |
| `TEACHER_SESSION_SECRET` | oui (≥32) | — | Session enseignant |
| `STUDENT_SESSION_SECRET` | oui (≥32) | — | Jeton élève |
| `DATABASE_URL` | oui | — | MySQL |
| `KIMI_AUTH_URL`, `KIMI_OPEN_URL` | oui | — | Serveurs OAuth |
| `ALLOWED_ORIGINS` | — | `http://localhost:3000` | CORS et CSRF |
| `LLM_API_KEY` | non | — | Sans elle, aucune assistance |
| `LLM_PROVIDER` / `LLM_API_URL` / `LLM_MODEL` | — | `openrouter` / OpenRouter / `anthropic/claude-sonnet-5` | |
| `LLM_MAX_TOKENS`, `LLM_TIMEOUT_MS` | — | 1000, 60000 | Surchargés par appel |
| `RAG_URL`, `RAG_API_KEY`, `RAG_COLLECTION`, `RAG_TIMEOUT_MS` | non | — / — / `default` / 10000 | Port débranché sans `RAG_URL` |
| `PAPER_OUTPUT_DIR` | — | `./.paper-exams` | Dossiers de tirage |
| `OWNER_UNION_ID` | fortement conseillé | — | Le seul compte provisionné administrateur |
| `PUBLIC_BASE_URL` | **oui en production** | — | Adresse publique ; seule source de la redirection OAuth |
| `LOG_LEVEL`, `BRAND_NAME`, `SENTRY_DSN`, `REDIS_URL` | non | | |
| `VITE_ETABLISSEMENT`, `VITE_ETABLISSEMENT_ADRESSE`, `VITE_DIRECTEUR_PUBLICATION`, `VITE_CONTACT_DONNEES`, `VITE_HEBERGEUR` | non | — | Mentions légales |

Aucun secret n'a de valeur par défaut : une valeur de repli écrite dans le
dépôt est une valeur publique, et signer un cookie enseignant avec elle ne
demanderait que de savoir lire. `scripts/bootstrap-dev.sh` en tire de nouveaux,
propres à la machine, dans un `.env` que Git ignore.

Les valeurs par défaut du tableau ci-dessus vivent dans `api/lib/env.ts` et
nulle part ailleurs : ni `docker-compose.yml` ni `.env.example` n'en proposent
d'autres, et `api/__tests__/config/contrat-env.spec.ts` le vérifie. La même
version de l'application se comporte donc pareil, qu'on la démarre par npm ou
par Docker.

---

## 12. Vérification

### Chaîne standard
```bash
npm run check   # tsc -b
npm run lint    # eslint (0 erreur, 3 avertissements react-hooks connus)
# Les tests d'intégration parlent à une vraie base. `scripts/bootstrap-dev.sh`
# a écrit TEST_DATABASE_URL dans `.env` ; la base est créée si elle manque.
npm test        # 868 tests, 67 fichiers
npm run build   # vite + esbuild
```

### Tests par domaine

| Fichier | Tests |
|---|---|
| `grading/normalize` | 44 |
| `authoring/generate-questions` | 24 |
| `authoring/question-coherence` | 18 |
| `paper/amc-template` | 18 |
| `grading/grade-session` | 17 |
| `anticheat/score-suspicion`, `grading/shuffle`, `security/public-surface` | 16 chacun |
| `grading/compare-fraction`, `compare-numeric`, `security/rate-limit` | 13, 13, 12 |
| `grading/compare-symbolic`, `grade-response` | 12 chacun |
| `anticheat/fingerprint`, `paper/parse-roster` | 11 chacun |
| `rag/rag-provider`, `security/no-leak-correct-answer` | 10 chacun |
| `anticheat/heartbeat` | 9 |
| `grading/llm-client` | 8 |
| `anticheat/auto-submit`, `paper/manual-entry`, `security/cheat-immutability`, `security/session-token` | 7 chacun |
| `anticheat/event-aggregator`, `grading/qcm-diagnostics`, `security/csrf-origin`, `security/role-access` | 6 chacun |
| `anticheat/idle-sweeper`, `security/timer-enforce` | 5 chacun |
| `authoring/seed-coherence` | 2 |

Les tests unitaires **ne touchent pas la base**.

### Vérifications de bout en bout

Contre un serveur démarré, avec un cookie obtenu par `dev-session.ts` :

```bash
npx tsx scripts/smoke-parcours-eleve.ts                # 22 contrôles
npx tsx scripts/smoke-atelier-enseignant.ts            # 22 contrôles
npx tsx scripts/smoke-chaine-papier.ts "$COOKIE"       # 14 contrôles
```

Le troisième rejoue tout depuis zéro : créer, rédiger, refuser une question
incohérente, constituer une classe, imprimer, vérifier que le PDF en est un,
saisir deux copies, contrôler la moyenne, vérifier qu'une évaluation avec copies
résiste à la suppression.

**C'est là qu'apparaissent les défauts que les tests unitaires ne voient pas.**
Tous les bugs majeurs listés au §14 ont été trouvés ainsi.

---

## 13. État exact

### Phases

| Phase | État |
|---|---|
| 1 — Sécurité et intégrité | ✅ tag `v0.1.0-security` |
| 2 — Moteur de correction mathématique | ✅ tag `v0.2.0-grading` |
| 3 — Anti-triche | ✅ tag `v0.3.0-anticheat` |
| 3.5 — Convergence front/back | ✅ commit `4375d7c` |
| 4 — Atelier QCM (lots 0, A à G) | ✅ commit `4375d7c` |
| 5 — Mise en production | ✅ `v1.0.0-rc1` |

### Critères de mise en service — 23 sur 23

Le détail, critère par critère avec la commande qui l'établit, est dans
[`RELEASE_EVIDENCE.md`](RELEASE_EVIDENCE.md). Résumé :

| | Critère | Preuve |
|---|---|---|
| 1–5 | fuites, jeton, expiration, score non falsifiable, rôle | `npm test -- public-surface`, recettes de bout en bout |
| 6 | 5 écritures équivalentes par réponse courte | test paramétré sur les cinq questions réelles |
| 7 | rendu LaTeX multi-navigateurs et surfaces réduites | 39 scénarios Playwright, trois moteurs, contre le build de production |
| 8 | saisie MathLive exploitable serveur | frappe → LaTeX → correction, sorties relevées en navigateur |
| 9 | auto-save survit à 30 s de coupure | coupure réseau réelle, trois moteurs |
| 10 | heartbeat 60 s, remise automatique 180 s | 210 s d'observation, constantes de production |
| 11 | suspicion affichée à l'enseignant | badge et incidents sur l'écran de correction |
| 12 | couverture ≥ 80 % global, 100 % `api/grading` | seuils inscrits dans `vitest.config.ts`, vérifiés en CI |
| 13 | migrations committées | `db/migrations/`, six fichiers |
| 14 | `docker compose up` < 30 s | **781 ms**, et 27 étapes de recette sur le runtime de production |
| 15 | CI verte sur `main` | run `33307711115` sur `f0922fc` |
| 16 | 0 `any`, 0 `@ts-ignore` | garde durable qui lit les sources |
| 17 | journal d'audit des notes manuelles | ajout seul, auteur, avant/après, motif, `requestId` |
| 18 | exports CSV et PDF | recettes de téléchargement réel, encodage et périmètre compris |
| 19 | interface en français | — |
| 20 | k6 : 200 élèves, p95 < 500 ms, 0 erreur | **p95 36,0 / 35,6 / 39,7 ms** sur trois campagnes consécutives |
| 21–23 | RGPD, `SECURITY.md`, README | — |

### Limite de capacité connue

Deux cents copies rendues **artificiellement au même instant** — ce qui n'est
pas le déroulement d'une épreuve — donnent un p95 de remise d'environ 2,09 s,
sans aucune erreur ni copie perdue. Le système ralentit, il ne rompt pas. Cette
limite est mesurée et documentée ; elle ne conditionne pas le critère 20.

Le même banc devra être rejoué sur l'infrastructure de déploiement, avec un
générateur de charge extérieur à la machine applicative, **avant `v1.0.0`** —
pas avant `rc1`.

### Données présentes en base de développement

Évaluation 1 « Évaluation de Mathématiques — Terminale Spécialité » :
11 QCM (11 pts), 5 réponses courtes (10 pts), 5 vrai/faux (10 pts) = **21
questions, 31 points**. La 11ᵉ QCM a été ajoutée par un test de génération.
Plusieurs classes et tirages de vérification, dont un élève anonymisé.

---

## 14. Défauts réels trouvés et corrigés

Cette liste vaut avertissement : chacun de ces défauts était **silencieux** et
n'a été révélé que par une exécution réelle. Elle indique où le projet est
fragile.

### Sécurité et intégrité

1. **Le frontend élève n'était pas branché sur le backend sécurisé.** Trois
   phases de durcissement étaient contournées à l'exécution : `correctAnswer`
   servie au navigateur, soumission sans jeton ni contrôle d'expiration,
   résultats de n'importe quelle copie lisibles par incrément d'identifiant.
2. **Les trois hooks élève utilisaient le mauvais client tRPC.** Heartbeat,
   auto-sauvegarde et remontée d'incidents répondaient `UNAUTHORIZED` : tout le
   pipeline anti-triche était inerte.

### Base de données

3. **La base ne pouvait pas être créée depuis le dépôt.** `db/migrations/` ne
   contenait que des `ALTER` sans journal ; `drizzle-kit migrate` les ignorait
   en silence. Baseline régénérée, ancien contenu dans `legacy/`.
4. **Les contraintes n'existaient que dans le SQL manuel.** Les quatre clés
   étrangères et la clé primaire composite d'`answer_drafts` étaient absentes de
   `schema.ts` : toute base régénérée les perdait.

### Correction

5. **Deux sources de vérité pour la bonne réponse.** `correctAnswer` et
   `gradingRubric.mode` pouvaient diverger ; seule la seconde décide.
6. **Les QCM auto-soumis valaient tous 0** : `auto-submit` ne reconvertissait
   pas l'index mélangé.
7. **Une copie papier parfaite plafonnait à 13,5/20** : le barème retenu était
   celui de l'évaluation entière, les réponses rédigées comptées perdues.
8. **Les notes manuelles étaient effacées** : `gradeSessionResponses`
   réécrivait toutes les réponses, `overrideGrade` compris.
9. **Sous-requête corrélée mal rendue par Drizzle** : `${evaluations.id}` sortait
   sans qualification de table et se reliait à la sous-requête —
   `q.evaluationId = q.id`, renvoyant 1 par coïncidence.
10. **Deux limites incohérentes** : diagnostics tronqués à 600, schéma exigeant
    400 ; toute proposition entre les deux était déclarée incohérente.
11. **Dix des vingt questions de référence** portaient `weight: 1` pour 2 points.

### Interface

12. **Boucle infinie dans `MathLatex`** : un `$` non apparié faisait tourner le
    parseur sans jamais avancer — la page entière se figeait, `body` compris.
13. **Le contenu passait sous la barre latérale**, tableau de bord compris :
    les composants shadcn étaient écrits en **syntaxe Tailwind v4**
    (`w-(--sidebar-width)`) sous Tailwind 3.4, qui les ignore. 30 classes
    converties dans 10 composants.
14. **La note disparaissait après validation** : la sélection dérivée « premier
    élève non saisi » basculait au moment même où la copie devenait saisie.

### Modèle de langage

15. **Sortie tronquée prise pour du JSON invalide** : `finish_reason: "length"`
    n'était pas lu. Un modèle à raisonnement consomme le budget avant d'écrire.
16. **Le garde-temps ne gardait rien** : annulé dès la réception des en-têtes,
    donc avant la lecture du corps — seule partie longue.

### Impression

17. **AMC exige un dossier `sujet-data/`** dérivé du nom du fichier, qu'il ne
    crée pas : « unable to open database ».
18. **Le nom s'imprimait entre guillemets** : `csvsimple` ne les retire pas.

---

## 15. Limites connues

- **Pas d'anti-copiage par permutation sur papier.** Conséquence assumée de la
  saisie manuelle. Pour avoir les deux, il faudrait enregistrer la permutation
  de chaque copie et la rejouer à la saisie.
- **Aucun export PDF des résultats** (critère 18). Le CSV existe.
- **Aucun journal d'audit** des modifications de notes (critère 17).
- **Limitation de débit en mémoire** : ne tient pas sur plusieurs instances.
- **`auto-multiple-choice` absent de l'image Docker** : il tire plusieurs
  gigaoctets de LaTeX. L'interface signale l'impression indisponible plutôt que
  d'échouer ; recette d'image dérivée dans `DEPLOYMENT.md`.
- **Le service RAG ne démarre pas** — voir §9.3.
- **Trois avertissements ESLint** subsistent (`react-hooks/exhaustive-deps` sur
  des mutations tRPC volontairement hors dépendances).
- **Secrets de session à valeur par défaut** en développement.
- Le tableau de bord `/dashboard` reste centré sur le mode en ligne et n'a pas
  été repensé pour l'atelier papier.

---

## 16. Déploiement

- `Dockerfile` multi-étapes (node:22-slim), utilisateur non privilégié,
  healthcheck sur `/api/health`. **Image construite et exécutée avec succès** :
  tRPC répond, la base est jointe, le conteneur passe `healthy`.
- `docker-compose.yml` — production : MySQL non publié sur l'hôte, application
  derrière `127.0.0.1:3000`, volume dédié aux tirages. Secrets obligatoires
  (`:?`) : un démarrage avec des valeurs par défaut signerait des jetons
  forgeables.
- `docker-compose.dev.yml` — MySQL seul, port 3307. Aucun mot de passe versionné :
  ils viennent du `.env` produit par `scripts/bootstrap-dev.sh`.
- `.github/workflows/ci.yml` — trois travaux : qualité (types, style, tests,
  build), **création de la base depuis le dépôt** (garde-fou contre la
  régression n° 3), construction de l'image. **Jamais exécuté** : demande une
  poussée.
- `DEPLOYMENT.md` — secrets, reverse proxy (délai 300 s, la génération prenant
  une à deux minutes), image dérivée avec AMC, sauvegardes.

**Redis a été volontairement écarté** du compose : la limitation de débit est en
mémoire et Redis ne servirait qu'en multi-instances.


### Campagne de mise en service — défauts trouvés en exécutant

Les précédents ont été trouvés en branchant l'application. Ceux-ci l'ont été en
la mesurant, en la déployant et en cherchant la couverture manquante. Tous
étaient silencieux.

**Correction mathématique.** Le champ de saisie mathématique existait mais
n'était utilisé nulle part ; en le branchant, on découvre que React affectait
`el.value` avant que MathLive n'ait défini le composant, ce qui masquait
définitivement l'accesseur : la réponse de l'élève n'atteignait jamais le
serveur. La normalisation ignorait `\frac12` — la sortie exacte de la frappe
« 1/2 », donc la fraction la plus courante de toutes. `Infinity` devenait
`infinity` au passage en minuscules, rendant fausse toute limite infinie. Le
mode « exact » comparait la réponse à la chaîne vide. Une réponse valant
l'infini était acceptée comme égale à **n'importe quoi** : « 1/0 » rapportait
tous les points. `\log(10)` était disloqué en `log(1)0*(10)`.

**Anti-triche.** Le battement de présence lisait un en-tête que personne
n'émettait : 401 systématique, surveillance inopérante. Le balayage
d'inactivité ne tournait jamais de lui-même — le seuil des 180 secondes ne
tenait que si un autre élève émettait. Le score de suspicion était calculé
avant l'inscription de la déconnexion : une copie abandonnée ressortait
« Propre ».

**Sécurité.** Les routes enseignant vérifiaient l'authentification, jamais la
propriété : à partir d'un simple entier, n'importe quel professeur pouvait
lire, recorriger, modifier une note et forcer la remise des copies d'un
collègue. Les secrets de session avaient une valeur par défaut **publiée dans
ce dépôt** : une production qui les oublie signe ses cookies avec une chaîne
lisible dans le code source.

**Déploiement.** Le bundle de production ne démarrait pas — collision de noms
entre le préambule esbuild et pdfkit, invisible en développement qui passe par
Vite. La procédure de migration documentée était inapplicable : `drizzle-kit`
est retiré de l'image. Le volume des sujets appartenait à root alors que le
processus tourne non privilégié : **l'impression était impossible** dans le
déploiement documenté.

**Intégrité.** Rien n'empêchait une copie de porter deux réponses à la même
question, et la base de développement en portait effectivement deux. Deux
remises simultanées remontaient une erreur SQL brute jusqu'à l'élève.

**Copie de l'élève.** Un rechargement de page perdait la composition en cours.
Sur un réseau qui pend — portail captif, borne saturée — la sauvegarde restait
bloquée indéfiniment sans rien mettre en file locale.

### Poids du client

Découpage par route et isolation des bibliothèques. Avant : 1 750 Ko pour tout
le monde. Après :

| Ressource | Taille | Chargée par |
|---|---|---|
| `index` | 671 Ko | tout le monde |
| `vendor-react` | 67 Ko | tout le monde |
| `vendor-math` (KaTeX, MathLive, mathjs) | 261 Ko | pages avec formules |
| `vendor-charts` (Recharts) | 424 Ko | tableau de bord seul |
| `EvaluationEditor` | 108 Ko | éditeur seul |

Élève ≈ 1,0 Mo · enseignant sur la liste ≈ 756 Ko.

---

## 17. Historique récent

```
4a0b188  feat(rgpd): mentions légales, confidentialité, droits d'accès et d'effacement
78db0dd  feat(phase-5): image de production, CI, découpage du bundle, interface en français
4375d7c  feat: atelier QCM enseignant — rédiger, imprimer, saisir, noter
dc2a926  feat: Phase 3 — anti-triche professionnel & robustesse
```

Dépôt distant : `https://github.com/cyranoaladin/eval_maths_term.git`
Branches locales : `main`, `phase-1-security`, `phase-2-grading`,
`phase-3-anticheat`, `phase-4-multiclass`, `phase-3.5-convergence` (courante).
Branches distantes connues : les cinq premières.

**La branche `phase-3.5-convergence` n'existe pas sur le distant et n'a jamais
été poussée.** Les trois commits récents — soit tout le travail des phases 3.5,
4 et 5 — sont **locaux uniquement**. C'est aussi pourquoi la CI n'a jamais été
exécutée.

`PLAN.md` détaille les phases lot par lot avec leur état.
`CHANGELOG.md` détaille chaque livraison.

---

## 18. Environnement de la machine

- MySQL de développement : conteneur `eval-maths-mysql-dev`, `127.0.0.1:3307`,
  base `eval_maths`, identifiants tirés au hasard dans `.env` par
  `scripts/bootstrap-dev.sh`
- `auto-multiple-choice` 1.6.0, `pdflatex`, `latexmk`, `automultiplechoice.sty`
  installés au niveau système
- Une clé OpenRouter est configurée dans `.env` (non versionné), modèle
  `anthropic/claude-sonnet-5`
- L'extension Chrome de pilotage n'est pas connectée ; les captures d'écran ont
  été prises avec Playwright installé hors du projet, pilotant
  `/opt/google/chrome/chrome`
- L'utilisateur exploite par ailleurs **Korrigo** (`korrigo.labomaths.tn`,
  conteneurs `korrigo-local-*`), plateforme Django/Vue de correction de copies
  **scannées**. Périmètre voisin mais distinct : Korrigo annote des copies
  manuscrites, cet atelier produit et dépouille des QCM.

---

## 19. Pour reprendre le travail

### Invariants à ne pas casser

1. `correctAnswer` et `gradingRubric` ne doivent jamais sortir d'une route
   accessible à un élève. Le test `public-surface.spec.ts` le vérifie.
2. Toute route `studentQuery` appelée depuis l'interface doit passer par
   `studentTrpc`, jamais par `trpc`.
3. Toute nouvelle procédure doit être ajoutée à l'inventaire de
   `public-surface.spec.ts`, sinon les tests échouent — c'est voulu.
4. Le gabarit AMC ne doit jamais mélanger tant que la saisie manuelle ne sait
   pas rejouer la permutation.
5. Une note de mode `manual_*` ne doit jamais être recalculée.
6. `printedQuestionIds` fige la composition d'un tirage : ne pas la recalculer
   depuis l'état courant des questions.

### Ordre suggéré pour la suite

1. **Écran de correction copie par copie** — `grading2.getResults`,
   `grading2.overrideGrade`, `grading2.gradeSession` et
   `question.getWithAnswersForTeacher` existent déjà côté serveur ; il manque la
   page. C'est ce qui manque le plus à un usage réel, avec l'export PDF.
2. **Export PDF des résultats** (critère 18).
3. **Journal d'audit** des notes manuelles (critère 17) — table `audit_log`.
4. **Couverture** (critère 12) : `@vitest/coverage-v8` est installé, aucun seuil
   n'est configuré.
5. **k6** (critères 14 et 20).
6. **Repenser `/dashboard`** pour l'atelier papier.

### Commandes utiles

```bash
# Session enseignant locale (l'OAuth Kimi est indisponible hors production)
npx tsx scripts/dev-session.ts

# Réinitialiser les données de démonstration
npx tsx db/seed.ts

# Inspecter la base
docker exec eval-maths-mysql-dev mysql --default-character-set=utf8mb4 \
  -ueval -p eval_maths -e "SHOW TABLES;"

# Vérifier une modification du moteur de correction
npx vitest run api/grading
npx tsx scripts/smoke-chaine-papier.ts "$(cat cookie.txt)"
```

### Documents du dépôt

| Fichier | Contenu |
|---|---|
| `README.md` | ce document |
| `PLAN.md` | feuille de route par phase et lot, 23 critères de mise en service |
| `CHANGELOG.md` | historique détaillé de chaque livraison |
| `DEPLOYMENT.md` | mise en production, reverse proxy, sauvegardes |
| `SECURITY.md` | modèle de menaces, données personnelles |

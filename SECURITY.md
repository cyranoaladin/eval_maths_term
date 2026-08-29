# Sécurité

## Ce que l'application protège

Trois choses ont de la valeur ici : les **corrections** avant une épreuve, les
**notes** après, et les **données des élèves** en permanence.

## Modèle de menaces

### Un élève cherche les réponses avant ou pendant l'épreuve

`questions.correctAnswer` et `questions.gradingRubric` ne sortent jamais d'une
route accessible à un élève. Les énoncés sont servis par
`question.getForActiveSession`, dont le `select` les exclut explicitement, et
`contracts/public-types.ts` ne les déclare pas.

`api/__tests__/security/public-surface.spec.ts` fige l'inventaire des
procédures montées et vérifie qu'aucune route élève ou enseignant n'aboutit
sans authentification. Toute route ajoutée fait échouer ce test tant qu'elle
n'a pas été inscrite volontairement.

### Un élève tente de forger son score

Le client n'envoie que des réponses. Le score, la note sur 20, le statut final
et le score de suspicion sont calculés côté serveur. `session.submit` n'accepte
aucun champ de notation, et n'accepte que les questions de l'évaluation liée à
la session.

Le timer fait autorité côté serveur : `expiresAt` est fixé à la création de la
session et vérifié à chaque mutation.

### Un élève lit la copie d'un autre

Les résultats exigent un jeton signé à durée courte, émis à la soumission.
L'ancienne route acceptait un identifiant de session en clair : toute copie
était lisible par simple incrément. Elle a été supprimée.

### Un enseignant compromis exécute du code sur le serveur

L'impression compile du LaTeX écrit par l'enseignant. Les énoncés ne peuvent
pas être échappés — cela casserait les formules — donc les primitives
d'exécution (`\write18`, `\input`, `\openout`, `\catcode`…) sont **refusées
avant compilation**, avec le numéro de la question fautive. AMC est lancé par
`execFile`, sans shell.

### Traversée de répertoire au téléchargement

`GET /api/paper/:id/:file` n'accepte que des noms de fichiers pris dans une
liste fermée. Aucun segment de chemin ne vient de l'URL. Le rôle enseignant et
la propriété de la classe sont vérifiés avant toute lecture disque.

### Falsification d'une session enseignant

Le cookie de session est un JWT signé avec `TEACHER_SESSION_SECRET`, distinct
d'`APP_SECRET`, d'au moins 32 caractères, valable 12 heures. `env.ts` refuse
de démarrer si le secret est trop court.

`scripts/dev-session.ts` fabrique une session locale : il exige le secret,
qu'aucune route ne délivre, et refuse de s'exécuter en production.

### CSRF

Toutes les mutations passent par `csrfMiddleware`, qui vérifie `Origin` et
`Referer` contre `ALLOWED_ORIGINS`. Le state OAuth est un `nanoid(32)` stocké
en cookie `HttpOnly`.

### Épuisement de ressources

Limites en mémoire par IP ou par utilisateur : démarrage de session, heartbeat,
et génération assistée (12 par tranche de 5 minutes, chaque appel étant
facturé). Corps de requête plafonné à 10 Mo.

## Données personnelles

L'application stocke des noms d'élèves, des adresses électroniques
facultatives, des adresses IP et des empreintes de navigateur — ces deux
dernières uniquement pour les épreuves en ligne, dans le cadre de la détection
de fraude.

Les listes d'élèves sont importées par l'enseignant depuis son logiciel de vie
scolaire. Elles ne sont transmises à aucun tiers. **Les énoncés envoyés au
service LLM ne contiennent jamais de nom d'élève** : la génération porte sur un
thème, pas sur une copie.

La correction assistée par LLM, elle, transmet la réponse rédigée de l'élève —
sans son nom. Si cela pose un problème à votre établissement, laissez
`LLM_API_KEY` vide : la correction retombe sur les comparateurs déterministes
et marque les réponses ouvertes comme à corriger manuellement.

## Signaler une faille

Écrivez à l'administrateur de l'instance. N'ouvrez pas de ticket public
décrivant une faille exploitable.

## Limites connues

- Aucun anti-copiage par permutation sur les sujets papier : le sujet est
  identique pour tous, condition de la saisie manuelle.
- La limitation de débit est en mémoire : elle ne tient pas sur plusieurs
  instances. Un déploiement multi-instances demande Redis.
- Pas de journal d'audit des modifications de notes (prévu, critère 17).

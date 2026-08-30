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

### Un enseignant lit les copies d'un autre

Une session appartient à l'enseignant propriétaire de son évaluation ; une
classe, un tirage et un élève à celui qui les a créés. Cette règle vit dans
`api/queries/ownership.ts`, en un seul endroit — elle avait été recopiée dans
l'atelier de rédaction, et deux routes hors de l'atelier ne la vérifiaient pas :

- **le suivi en direct** rendait, pour n'importe quelle évaluation, les noms et
  courriels des élèves qui la composaient, leur avancement, leur score de
  suspicion et le détail de leurs incidents ;
- **la génération papier** contrôlait la propriété de la classe mais pas celle
  de l'évaluation : un enseignant imprimait le sujet et le corrigé d'un collègue.

Le refus est un `NOT_FOUND`, jamais un `FORBIDDEN` : il ne confirme pas
l'existence d'une copie qu'on ne possède pas.

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

### Un inconnu ouvre une session et devient enseignant

Une authentification réussie ne donne aucun droit. Un compte créé à la première
connexion est `student` / `pending` : il existe, un administrateur le voit, et
il n'ouvre aucun écran. Le rôle et l'autorisation sont décidés par le serveur —
jamais transmis par le client, jamais déduits du fournisseur OAuth.

Seul le compte désigné par `OWNER_UNION_ID` est provisionné administrateur ;
sans lui, une installation neuve n'aurait personne pour autoriser le premier
enseignant. Une reconnexion ne restaure jamais un accès révoqué. Et l'on refuse
de retirer le dernier accès administrateur actif : une installation sans
administrateur ne peut plus autoriser personne.

`disabled` révoque sans effacer : un enseignant qui quitte l'établissement
laisse derrière lui des classes, des tirages et des notes dont il est l'auteur.

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
- L'autorisation d'un compte n'envoie aucune notification : un administrateur
  doit consulter l'écran « Comptes » pour voir les demandes en attente.
- Les évaluations sans propriétaire — antérieures au champ, dont l'évaluation
  de référence — restent partagées entre tous les enseignants autorisés.

## Ce que la campagne de mise en service a corrigé

Quatre défauts de sécurité ont été trouvés en exécutant l'application, pas en
la relisant. Ils sont consignés ici parce qu'ils indiquent où le projet était
fragile.

**Cloisonnement entre enseignants.** Les routes enseignant vérifiaient
l'authentification, jamais la propriété : à partir d'un simple identifiant de
session — un entier — n'importe quel professeur connecté pouvait lire une
copie, la recorriger, changer une note, forcer une remise et consulter le
journal d'audit d'un collègue. Une session appartient désormais à l'enseignant
propriétaire de son évaluation, un tirage au propriétaire de sa classe. Le
refus est un `NOT_FOUND`, jamais un `FORBIDDEN` : il ne confirme pas
l'existence d'une copie qu'on ne possède pas.

**Secrets de session.** `TEACHER_SESSION_SECRET` et `STUDENT_SESSION_SECRET`
avaient une valeur par défaut, publiée dans ce dépôt. Un déploiement qui les
oubliait démarrait normalement et signait ses cookies avec une chaîne lisible
dans le code source : forger une session d'administration ne demandait que de
savoir cloner le projet. Le démarrage refuse maintenant ces valeurs, les motifs
de remplissage (`dev_`, `change_me`, `test_`) et deux secrets identiques —
lesquels laisseraient un jeton élève passer pour un jeton enseignant.

Générer un secret réel :

```bash
openssl rand -base64 48
```

**Identifiant de requête.** Il est repris de l'appelant seulement s'il
correspond à une forme close ; toute autre valeur est remplacée par un
identifiant fabriqué par le serveur. Recopier une chaîne arbitraire dans les
journaux, c'est offrir une injection de contenu à qui les lit.

**Intégrité des copies.** Rien n'empêchait une copie de porter deux réponses à
la même question, et deux remises simultanées remontaient une erreur SQL brute
jusqu'à l'élève. La règle est désormais tenue par la base, donc vraie sous
concurrence, et la remise est prise en un ordre atomique.

## Ce qui reste à la charge de l'exploitant

- Secrets réels, distincts, générés — jamais ceux du dépôt.
- HTTPS et `ALLOWED_ORIGINS` restreint aux origines réelles.
- Base non exposée : seule l'application y accède.
- Sauvegardes, et **restauration éprouvée** avant la mise en service.
- Contrôle préalable d'unicité avant toute migration d'un environnement réel
  (voir `DEPLOYMENT.md`).


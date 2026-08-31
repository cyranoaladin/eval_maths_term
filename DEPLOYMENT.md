# Déploiement

## Ce dont vous avez besoin

- Docker et Docker Compose
- Un nom de domaine et un certificat TLS si l'application est exposée
- Une application OAuth Kimi (identifiant et secret)
- Facultatif : une clé LLM pour la génération assistée de questions
- Facultatif : `auto-multiple-choice` pour l'impression — voir plus bas

## Mise en route

```bash
cp .env.example .env
```

`.env.example` est la liste complète de ce que l'application lit. Il ne porte
aucune valeur : les valeurs par défaut vivent dans `api/lib/env.ts`, et nulle
part ailleurs — ni ce fichier, ni le compose, ni cette page n'en proposent
d'autres. Un test le vérifie à chaque exécution de la CI.

Renseignez au minimum :

| Variable | Rôle |
|---|---|
| `MYSQL_ROOT_PASSWORD`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | Base de données |
| `APP_ID`, `APP_SECRET` | Application OAuth Kimi |
| `TEACHER_SESSION_SECRET`, `STUDENT_SESSION_SECRET` | Signature des jetons de session |
| `KIMI_AUTH_URL`, `KIMI_OPEN_URL` | Serveurs OAuth |
| `PUBLIC_BASE_URL` | Adresse publique en `https` — **requise en production** |
| `ALLOWED_ORIGINS` | Origines autorisées, séparées par des virgules |
| `DATABASE_URL` | Imposée par le compose ; à renseigner hors conteneur |
| `OWNER_UNION_ID` | Le seul compte provisionné administrateur — voir ci-dessous |

**Renseignez `OWNER_UNION_ID`.** Une authentification réussie ne donne aucun
droit : un compte inconnu qui se connecte arrive « en attente » et n'ouvre aucun
écran. Le compte désigné par cette variable est le seul provisionné
administrateur, et c'est depuis l'écran « Comptes » qu'il autorise les
enseignants. Sans elle, personne ne pourra autoriser personne.

Les trois secrets doivent faire **au moins 32 caractères** et être distincts les
uns des autres. Générez-les :

```bash
openssl rand -base64 48
```

Aucun n'a de valeur par défaut. Une valeur de repli écrite dans le dépôt est une
valeur publique : signer un cookie enseignant avec elle ne demande que de savoir
lire. `env.ts` refuse par ailleurs de démarrer en production si un secret
ressemble à une valeur de remplissage (`dev_…`, `change_me`, `test_…`), ou si
deux d'entre eux sont identiques — un jeton élève pourrait alors passer pour un
jeton enseignant.

Le compose passe `.env` au conteneur tel quel et n'impose que trois valeurs, qui
décrivent la topologie du conteneur et non un choix d'exploitation :
`NODE_ENV=production`, l'adresse interne de la base, et le volume des tirages
papier.

```bash
docker compose up -d --build
docker compose exec app node dist/migrate.js
docker compose exec app node dist/seed.js   # évaluation de démonstration, facultatif
```

L'image ne contient ni npm, ni npx, ni yarn : le serveur démarre par `node`, les
migrations et le semis aussi. Les gestionnaires de paquets traînaient une
dizaine de vulnérabilités élevées à critiques dans une image qui ne les
exécutait jamais — et offraient de quoi installer ce qu'on veut à qui y
entrerait.

L'application écoute sur `127.0.0.1:3000`. Elle n'est pas exposée directement :
placez un reverse proxy devant.

## Reverse proxy

```nginx
server {
    listen 443 ssl http2;
    server_name qcm.exemple.fr;

    ssl_certificate     /etc/letsencrypt/live/qcm.exemple.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/qcm.exemple.fr/privkey.pem;

    # Les documents imprimables pèsent quelques centaines de kilooctets.
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # La génération assistée demande une à deux minutes : le délai par
        # défaut de 60 s couperait la requête en plein travail.
        proxy_read_timeout 300s;
    }
}
```

`PUBLIC_BASE_URL` et `ALLOWED_ORIGINS` doivent désigner la même adresse
publique. La première est la seule source de l'URL de redirection OAuth :
l'application ne la déduit jamais de l'en-tête `Host`, ni de
`X-Forwarded-Host`, parce que ces en-têtes viennent du client et qu'un proxy
qui les transmet sans les valider suffirait à détourner le code
d'autorisation.

`ALLOWED_ORIGINS` doit contenir l'URL publique exacte, sans quoi la protection
CSRF rejette toutes les mutations.

## Impression des sujets

**L'image de production embarque `auto-multiple-choice`.** C'est le défaut, et
c'est l'unique image : celle que la CI construit, celle que la recette éprouve,
celle que le compose démarre.

Il y en avait deux — une légère sans AMC, et une variante avec — et le compose
construisait la légère. Un `docker compose up -d` « de production » démarrait
donc une application incapable d'imprimer un sujet, alors que l'atelier papier
est la moitié du produit. Pire : la recette éprouvait l'autre image, si bien que
ce qui était vérifié n'était pas ce qui était déployé.

Le prix est la taille : environ 3,3 Go, dont deux pour la chaîne LaTeX. Un
établissement qui n'évalue qu'en ligne peut construire l'étage allégé —

```bash
docker build --target sans-impression -t atelier-qcm:sans-impression .
```

— mais ce n'est plus le défaut, et rien ne le construit tout seul. Sans AMC,
l'application fonctionne normalement et l'interface signale l'impression comme
indisponible plutôt que d'échouer.

## Ce qui fige l'artefact

L'image de base est épinglée **par empreinte**, pas par étiquette :
`node:22-trixie-slim` désigne une image différente chaque semaine, et deux
constructions du même commit doivent produire la même chose.

```bash
bash scripts/relever-empreintes-images.sh   # montre l'écart, demande confirmation
```

Après une montée volontaire : reconstruire, relancer la recette, refaire passer
le scan. Ces trois-là vont ensemble.

## Supervision des erreurs

Renseignez `SENTRY_DSN` — n'importe quel collecteur parlant ce protocole
convient, hébergé ou non. Sans elle, une erreur de production s'écrit sur la
sortie standard du conteneur et ne va pas plus loin.

```bash
docker compose exec app node dist/boot.js --version   # rappel de la version
npx tsx scripts/verifier-supervision.ts               # envoie une erreur de vérification
```

Le script produit un événement reconnaissable et dit quoi chercher dans la
console du collecteur. **À lancer après chaque déploiement** : une supervision
qu'on n'a jamais vue fonctionner n'est pas une supervision.

**Ce qui ne part jamais.** Une copie d'élève est une donnée scolaire — nom,
réponses, notes, incidents de surveillance —, et un jeton de session donnerait
l'accès avec le rapport. Le corps des requêtes, les en-têtes, les cookies et
l'utilisateur sont retirés avant l'envoi ; les jetons et les adresses de base
avec identifiants sont effacés du texte lui-même, y compris au fond d'un message
d'erreur. Reste l'erreur, sa pile, la route, la version, l'empreinte Git et
l'identifiant de requête — celui qui permet de retrouver la ligne
correspondante dans les journaux du serveur.

**Le navigateur n'envoie rien.** Y ajouter un collecteur ferait télécharger son
client à chaque élève, au démarrage de chaque épreuve, sur le réseau d'un
établissement. `src/lib/journal.ts` est le point unique où un tel envoi se
brancherait, le jour où ce coût se justifie.

## Chaîne d'approvisionnement

```bash
npm run audit:prod    # 0 vulnérabilité élevée ou critique en production
npm run sbom          # nomenclature CycloneDX 1.6
npm run scan:image    # vulnérabilités de l'image
```

Le seuil du scan d'image est « aucune vulnérabilité élevée ou critique **pour
laquelle un correctif existe** ». C'est le seul critère actionnable : une faille
sans correctif amont ne se répare pas en la déclarant inacceptable. Celles-là
sont listées à chaque passage — on sait ce qu'on porte — et la porte se ferme
d'elle-même le jour où un correctif paraît.


## Deux portes distinctes

Ne pas confondre ce que `v1.0.0-rc1` atteste et ce qu'il faut encore vérifier
sur la machine qui servira réellement.

### RC1 — porte de performance, franchie

Le critère 20 de `PLAN.md` — « 200 élèves concurrents, p95 < 500 ms,
0 erreur » — est satisfait sur le banc de release : parcours complet, build de
production, trois campagnes consécutives, p95 de 36,0 / 35,6 / 39,7 ms, zéro
erreur. Détail et méthode dans `RELEASE_EVIDENCE.md` §9.

Une limite de capacité est connue : deux cents copies rendues artificiellement
au même instant donnent un p95 d'environ 2,09 s, sans erreur ni perte. Ce n'est
pas le déroulement d'une épreuve.

### Production — validation de capacité, à faire avant `v1.0.0`

Le même banc doit être rejoué sur l'infrastructure retenue, avec un
**générateur de charge extérieur à la machine applicative** : exécuté sur la
même machine, il prend le processeur de ce qu'il mesure.

À mesurer et à consigner :

| | |
|---|---|
| Architecture | instances applicatives, base séparée ou non, proxy en amont |
| Générateur | machine distincte, latence réseau vers l'application |
| Base | version, `max_connections`, stockage, latence application → base |
| `DB_POOL_SIZE` | balayer au moins 20 / 40 / 60 / 80 sans dépasser `max_connections` |
| Machine | processeur, mémoire, attente de pool, connexions actives maximum |
| Mesures | scénario d'acceptation (trois campagnes) et test de résistance |

```bash
# depuis la machine du générateur
BASE_URL=https://<cible> bash scripts/mesure-acceptation.sh 3
docker run --rm -i grafana/k6 run - < load/burst-submit.k6.js \
  -e BASE_URL=https://<cible> -e VUS=200
```

`DB_POOL_SIZE=60` est un optimum mesuré sur le banc, pas une constante de
production.

## Migrer une base portant de vraies copies

La contrainte d'unicité sur `responses(sessionId, questionId)` est **fermée par
défaut** : si la base contient des doublons, MySQL refuse l'ordre et la
migration s'arrête sans rien supprimer. C'est voulu — deux réponses à une même
question sont une information, parfois le signe d'un incident.

Avant toute migration d'un environnement réel :

```sql
SELECT sessionId, questionId, COUNT(*)
FROM responses
GROUP BY sessionId, questionId
HAVING COUNT(*) > 1;
```

ou, depuis un poste :

```bash
DATABASE_URL=<url> npx tsx scripts/preflight-unicite-reponses.ts
```

| Résultat | Conduite |
|---|---|
| Aucune ligne | poursuivre ; la migration passe |
| Doublons **strictement identiques** | **arrêt.** Réparation explicite par un opérateur, après accord : `npx tsx scripts/reparer-doublons-reponses.ts --appliquer` |
| Doublons **divergents** | **arrêt absolu.** Investigation humaine : laquelle des deux réponses est celle de l'élève ? Le script refuse de trancher |

Aucune suppression automatique, dans aucun cas. La commande de réparation ne
figure pas dans la migration et n'y figurera pas.

### Si vous montez un dossier de l'hôte plutôt qu'un volume

Le conteneur s'exécute sous un utilisateur non privilégié — `evalapp`, uid
`10001`. Les volumes nommés de `docker-compose.yml` héritent des droits du
dossier de l'image et ne posent pas de question. Un dossier de l'hôte monté à
la place, lui, appartient à l'utilisateur qui l'a créé : l'application ne peut
pas y écrire, aucun sujet n'est produit, et `/api/ready` répond `503` avec
`tirages: EACCES`. Donnez-le à l'uid du conteneur avant de démarrer :

```bash
sudo chown -R 10001:10001 /chemin/vers/tirages
```

## Sauvegardes

Deux volumes portent des données non reconstructibles :

- `mysql_data` — évaluations, copies, notes
- `paper_exams` — sujets et corrigés produits

Les deux se sauvegardent ensemble, dans une archive horodatée dont l'intégrité
se vérifie :

```bash
DATABASE_URL=mysql://... PAPER_OUTPUT_DIR=/var/lib/atelier/tirages \
  bash scripts/sauvegarde.sh /var/backups/atelier
```

L'archive contient le cliché de la base — pris en une seule transaction, sans
verrou, une épreuve peut se dérouler pendant —, l'archive des tirages, un
manifeste (version, empreinte git, base, date) et les empreintes SHA-256. Le
script refuse de rendre la main si le cliché ne contient pas les treize tables :
une sauvegarde tronquée ne doit pas passer pour une sauvegarde.

À automatiser par `cron`, une fois par nuit et avant chaque déploiement :

```cron
30 2 * * *  cd /opt/atelier && DATABASE_URL=... PAPER_OUTPUT_DIR=... bash scripts/sauvegarde.sh /var/backups/atelier >> /var/log/atelier-sauvegarde.log 2>&1
```

### Restaurer

```bash
DATABASE_URL=mysql://... PAPER_OUTPUT_DIR=/var/lib/atelier/tirages \
  bash scripts/restauration.sh /var/backups/atelier/20260831T003052Z
```

La base cible est écrasée — c'est le sens d'une restauration, mais ne la
dirigez pas vers une base en service. Le script vérifie les empreintes avant de
toucher à quoi que ce soit, puis compte ce qu'il a remis : évaluations,
questions, copies, réponses, interventions tracées, migrations appliquées. Une
base restaurée vide, ou dont le journal des migrations est vide, arrête le
script au lieu d'être déclarée bonne.

Une évaluation portant des copies ne peut pas être supprimée depuis
l'interface — mais une restauration partielle, elle, peut casser ce lien.
Restaurez toujours la base entière.

### Ce que la répétition a montré

La procédure a été jouée pour de bon, pas seulement écrite : base migrée
sauvegardée, base détruite, archive restaurée, application redémarrée dessus.
Elle a rendu ses 20 questions, ses 2 copies, ses notes et son sujet imprimé, et
`/api/ready` est repassé au vert sur les six contrôles. La répétition a aussi
montré ce que la procédure oubliait : l'archive des tirages, extraite par
l'utilisateur qui restaure, revenait avec les droits de celui-ci et non ceux du
conteneur. Le script le corrige désormais, ou le dit à voix haute quand il ne le
peut pas.

## Mise à jour

```bash
git pull
docker compose up -d --build
docker compose exec app node dist/migrate.js
```

Les migrations sont additives et rejouables. Sauvegardez avant, malgré tout.

### La procédure complète, sur une base qui porte de vraies copies

```bash
DATABASE_URL=mysql://... PAPER_OUTPUT_DIR=/var/lib/atelier/tirages \
  bash scripts/migration-production.sh /var/backups/atelier
```

Cinq étapes, dans cet ordre, chacune pouvant arrêter la suivante :

| # | Étape | Ce qu'elle garantit |
|---|---|---|
| 1 | sauvegarde | l'archive existe, s'ouvre, et contient les treize tables |
| 2 | état avant | le nombre de migrations déjà appliquées est noté |
| 3 | préflights | unicité des réponses, accès enseignant, incidents JSON, invariants |
| 4 | migration | `node dist/migrate.js`, depuis l'image |
| 5 | postflight | le journal a avancé, et les invariants tiennent |

Un préflight qui relève une divergence **arrête la migration** et ne corrige
rien : la décision revient à un opérateur. Un postflight en échec dit
explicitement que la base a été modifiée et qu'il faut restaurer.

La procédure a été jouée sur une base au schéma de `v1.0.0-rc1` portant des
copies, des notes et des incidents rangés dans l'ancienne colonne JSON : six
migrations sont devenues dix, et les deux incidents JSON se sont retrouvés dans
`cheat_events` avec leur type et leur horodatage avant que la colonne ne soit
retirée.

## Revenir à la version précédente

Un retour arrière n'est pas seulement une image qu'on redémarre : le schéma a
pu changer, et l'ancienne version ne sait pas lire le nouveau. La base revient
avec elle, depuis la sauvegarde prise juste avant la migration.

```bash
DATABASE_URL=mysql://... PAPER_OUTPUT_DIR=/var/lib/atelier/tirages \
  bash scripts/repli-production.sh \
    ghcr.io/…/atelier-qcm@sha256:<empreinte de la version précédente> \
    /var/backups/atelier/20260831T003052Z
```

L'image se désigne **par son empreinte**, jamais par une étiquette : `v1.0.0`
peut avoir été reconstruite, une empreinte non. Relevez-la avant chaque
déploiement :

```bash
docker image inspect <image> --format '{{index .RepoDigests 0}}'
```

Le script arrête la version en place par `docker stop` — SIGTERM, donc arrêt
gracieux : les remises en cours vont à leur terme —, restaure la base et les
tirages, redémarre l'image précédente, puis vérifie que le service se déclare
prêt et annonce bien la version attendue.

La répétition a été faite : une version en service, une sauvegarde, un incident
simulé (dix questions supprimées, toutes les notes remises à zéro, le sujet
effacé), puis le repli. Le service est revenu sur `v1.0.0-rc1`, prêt sur les six
contrôles, avec ses vingt questions, ses deux copies notées et son sujet.

## Vérification

```bash
curl -s https://qcm.exemple.fr/api/ready
```

Trois scripts rejouent les parcours complets contre une instance démarrée —
voir `scripts/smoke-*.ts`. Ils exigent une session enseignant, produite par
`scripts/dev-session.ts`, réservé au développement.

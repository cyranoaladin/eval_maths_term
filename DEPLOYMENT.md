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
docker compose exec app npx tsx db/seed.ts   # évaluation de démonstration, facultatif
```

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

`ALLOWED_ORIGINS` doit contenir l'URL publique exacte, sans quoi la protection
CSRF rejette toutes les mutations.

## Impression des sujets

L'image de production **n'embarque pas** `auto-multiple-choice` : il tire une
chaîne LaTeX complète de plusieurs gigaoctets, inutile aux établissements qui
n'évaluent qu'en ligne. Sans lui, l'application fonctionne normalement et
l'interface signale l'impression comme indisponible.

Pour l'activer, construisez une image dérivée :

```dockerfile
FROM eval-maths:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
      auto-multiple-choice texlive-latex-extra texlive-lang-french \
 && rm -rf /var/lib/apt/lists/*
USER evalapp
```

Comptez environ 2 Go d'image supplémentaire.


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

## Sauvegardes

Deux volumes portent des données non reconstructibles :

- `mysql_data` — évaluations, copies, notes
- `paper_exams` — sujets et corrigés produits

```bash
docker compose exec -T mysql mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" \
  --single-transaction eval_maths | gzip > sauvegarde-$(date +%F).sql.gz
```

Une évaluation portant des copies ne peut pas être supprimée depuis
l'interface — mais une restauration partielle, elle, peut casser ce lien.
Restaurez toujours la base entière.

## Mise à jour

```bash
git pull
docker compose up -d --build
docker compose exec app node dist/migrate.js
```

Les migrations sont additives et rejouables. Sauvegardez avant, malgré tout.

## Vérification

```bash
curl -s https://qcm.exemple.fr/api/health
```

Trois scripts rejouent les parcours complets contre une instance démarrée —
voir `scripts/smoke-*.ts`. Ils exigent une session enseignant, produite par
`scripts/dev-session.ts`, réservé au développement.

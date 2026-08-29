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

Renseignez au minimum :

| Variable | Rôle |
|---|---|
| `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` | Base de données |
| `APP_ID`, `APP_SECRET` | Application OAuth Kimi |
| `TEACHER_SESSION_SECRET`, `STUDENT_SESSION_SECRET` | Signature des jetons de session |
| `KIMI_AUTH_URL`, `KIMI_OPEN_URL` | Serveurs OAuth |
| `ALLOWED_ORIGINS` | Origines autorisées, séparées par des virgules |

Les deux secrets de session doivent faire **au moins 32 caractères** et être
distincts d'`APP_SECRET`. Générez-les :

```bash
openssl rand -hex 32
```

`env.ts` refuse de démarrer si une variable requise manque ou est trop courte.
C'est voulu : une application qui démarre avec un secret par défaut signe des
jetons que n'importe qui peut forger.

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

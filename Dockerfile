# syntax=docker/dockerfile:1
#
# Image de production.
#
# Une seule, et elle sait imprimer. Il y en avait deux : une légère sans
# `auto-multiple-choice`, et une variante avec. Le compose de production
# construisait la légère — un `docker compose up -d` démarrait donc une
# application incapable d'imprimer un sujet, alors que l'atelier papier est la
# moitié du produit. La recette, elle, éprouvait l'autre : ce qui était vérifié
# n'était pas ce qui était déployé.
#
# L'étage `sans-impression` reste disponible pour un établissement qui n'évalue
# qu'en ligne — `docker build --target sans-impression` —, mais ce n'est plus le
# défaut, et rien ne le construit tout seul.
#
# La base est épinglée par empreinte, pas par étiquette : `node:22-trixie-slim`
# désigne une image différente chaque semaine, et deux constructions du même
# commit doivent produire la même chose. Pour la relever après une mise à jour
# volontaire : `scripts/relever-empreintes-images.sh`.
ARG NODE_IMAGE=node@sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284

# ── Construction ─────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Version et empreinte Git sont inscrites dans le binaire : le dépôt n'est pas
# présent dans l'image finale, et `docker compose ps` ne dit pas quel commit
# répond. `/api/health` les expose.
ARG APP_VERSION
ARG GIT_SHA
ENV APP_VERSION=${APP_VERSION}
ENV GIT_SHA=${GIT_SHA}
RUN npm run build

# Dépendances de production uniquement, pour l'image finale.
RUN npm prune --omit=dev

# ── Exécution, sans impression ───────────────────────────────────────────────
FROM ${NODE_IMAGE} AS sans-impression
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Les correctifs de sécurité publiés depuis la construction de l'image de base.
# Sans cette étape, l'image hérite d'une photographie datée du jour où l'image
# amont a été publiée.
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

# Utilisateur non privilégié : le processus n'a aucune raison d'être root.
RUN useradd --system --create-home --uid 10001 evalapp

COPY --from=builder --chown=evalapp:evalapp /app/dist ./dist
COPY --from=builder --chown=evalapp:evalapp /app/node_modules ./node_modules
COPY --from=builder --chown=evalapp:evalapp /app/package.json ./package.json
COPY --from=builder --chown=evalapp:evalapp /app/db ./db

# Ni npm, ni npx, ni yarn dans le runtime.
#
# Le serveur démarre par `node dist/boot.js` et les migrations par
# `node dist/migrate.js` : aucun gestionnaire de paquets n'est nécessaire. Les
# leurs traînaient une dizaine de vulnérabilités élevées à critiques — `tar`,
# `pacote`, `sigstore` — dans une image qui ne les exécutait jamais. Un
# gestionnaire de paquets dans un conteneur de production, c'est aussi de quoi
# installer ce qu'on veut à qui y entrerait.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm /usr/local/bin/npx \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Le dossier des sujets imprimables est créé dans l'image et donné à
# l'utilisateur applicatif. Sans cela, Docker crée le volume nommé avec les
# droits de root : le processus, non privilégié, ne peut rien y écrire et la
# génération des sujets échoue sur « EACCES: permission denied ». L'impression
# — la raison d'être de l'atelier papier — était donc impossible dans le
# déploiement documenté.
RUN mkdir -p /data/paper-exams && chown -R evalapp:evalapp /data
ENV PAPER_OUTPUT_DIR=/data/paper-exams

USER evalapp
EXPOSE 3000

# Le contrôle interroge la disponibilité, pas la vivacité : un conteneur qui
# répond mais dont la base est injoignable ne doit pas être déclaré sain. Le
# délai de grâce couvre le démarrage ; au-delà, l'écart se voit.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Un `docker stop` envoie SIGTERM puis attend : le serveur cesse d'accepter,
# laisse finir les remises en cours et rend ses connexions. Sans ce délai,
# Docker tue au bout de dix secondes.
STOPSIGNAL SIGTERM

CMD ["node", "dist/boot.js"]

# ── Exécution, avec impression : l'image de production ───────────────────────
#
# `auto-multiple-choice` tire une chaîne LaTeX complète : environ deux
# gigaoctets de plus. C'est le prix de l'impression des sujets, et c'est
# l'artefact que la recette éprouve, que le compose démarre et que la CI
# construit — le même, du contrôle au déploiement.
# ── Récupération des paquets AMC ─────────────────────────────────────────────
#
# Isolée pour que `curl` et les certificats ne mettent jamais un pied dans
# l'image livrée : rien à purger ensuite. Les deux archives sont figées par
# version et vérifiées par empreinte — une modification amont fait échouer la
# construction plutôt que de passer inaperçue.
FROM ${NODE_IMAGE} AS paquets-amc
ARG AMC_VERSION=1.7.0-3
ARG AMC_COMMON_SHA256=845c7e3e67251f1891aa2bddce5a215d38ed4a5338631e736e198f7c39a5d5d8
ARG AMC_MAIN_SHA256=04330c73434cae767c7ed27ad1e04f8d3560403f03763834899c0af810eb6c33
ARG AMC_MIROIR=http://deb.debian.org/debian/pool/main/a/auto-multiple-choice
WORKDIR /paquets
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSLO "${AMC_MIROIR}/auto-multiple-choice-common_${AMC_VERSION}_all.deb" \
 && curl -fsSLO "${AMC_MIROIR}/auto-multiple-choice_${AMC_VERSION}_amd64.deb" \
 && echo "${AMC_COMMON_SHA256}  auto-multiple-choice-common_${AMC_VERSION}_all.deb" | sha256sum -c - \
 && echo "${AMC_MAIN_SHA256}  auto-multiple-choice_${AMC_VERSION}_amd64.deb" | sha256sum -c -

FROM sans-impression AS production

USER root

# ── Ce que la composition demande vraiment ───────────────────────────────────
#
# `apt-get install auto-multiple-choice` installe la chaîne AMC **entière** :
# lecture optique (OpenCV), traitement d'images (GraphicsMagick, et derrière
# lui ImageMagick, OpenEXR, libraw, GDCM) et interface graphique (GTK 3). Cent
# soixante et onze vulnérabilités élevées ou critiques, sans correctif amont,
# entraient par là — pour un chemin que ce produit n'emprunte pas.
#
# Une génération réelle a été tracée : `prepare --mode s` n'exécute que `perl`,
# `pdflatex`, les outils `kpse*`, la génération de polices et quelques
# commandes de base. Elle charge une trentaine de modules Perl — DBI,
# DBD::SQLite, XML::Simple, XML::Writer, Locale::gettext, Glib — et **aucun**
# module GTK, GraphicsMagick ou OpenCV. Les seuls binaires compilés d'AMC,
# `AMC-detect` et `AMC-buildpdf`, appartiennent à l'analyse des scans et à
# l'annotation des copies : ils ne sont jamais lancés.
#
# On installe donc les dépendances réelles, et on pose les fichiers d'AMC
# depuis ses paquets officiels, épinglés par version et vérifiés par empreinte.
# Voir docs/ADR-OPTICAL-CORRECTION-BOUNDARY.md et docs/AMC-RUNTIME.md.
RUN apt-get update && apt-get install -y --no-install-recommends \
      perl \
      libdbi-perl \
      libdbd-sqlite3-perl \
      libxml-simple-perl \
      libxml-writer-perl \
      liblocale-gettext-perl \
      libglib-perl \
      libtext-csv-perl \
      libhash-merge-perl \
      texlive-latex-base \
      texlive-latex-recommended \
      texlive-latex-extra \
      texlive-fonts-recommended \
      texlive-lang-french \
 && rm -rf /var/lib/apt/lists/*

# Les fichiers d'AMC arrivent de l'étape de récupération, déjà vérifiés.
COPY --from=paquets-amc /paquets/*.deb /tmp/paquets/
RUN dpkg-deb -x /tmp/paquets/auto-multiple-choice-common_*.deb / \
 && dpkg-deb -x /tmp/paquets/auto-multiple-choice_*.deb / \
 && rm -rf /tmp/paquets \
 # Les binaires compilés n'appartiennent qu'à la lecture optique et à
 # l'annotation des copies : sans eux, rien ne peut réclamer OpenCV.
 && rm -rf /usr/libexec/AMC/exec \
 # La classe LaTeX arrive hors de l'arbre TeX Live : il faut le lui dire.
 && mktexlsr

# Vérification à la construction : sans ces éléments, l'image est inutile et il
# vaut mieux le savoir maintenant. `auto-multiple-choice version` ouvre
# l'interface graphique et échoue sans écran : on vérifie ce que l'application
# vérifie — l'exécutable est dans le PATH — et ce dont la composition a besoin,
# le répartiteur Perl et la classe LaTeX.
RUN which auto-multiple-choice \
 && test -f /usr/libexec/AMC/perl/AMC-prepare.pl \
 && kpsewhich automultiplechoice.sty \
 # Et l'inverse : rien de la chaîne optique ne doit être revenu. On interroge
 # l'état d'installation, pas la simple présence au catalogue : dpkg garde une
 # ligne « not-installed » pour des paquets jamais posés.
 && ! test -e /usr/libexec/AMC/exec \
 && test -z "$(dpkg-query -W -f='${binary:Package} ${db:Status-Status}\n' \
      | awk '$2 == "installed" { print $1 }' \
      | grep -Ei 'opencv|graphicsmagick|graphics-magick|imagemagick|gtk3-perl|openexr|libraw|gdcm')" \
 && test -z "$(find / -xdev \( -name 'libopencv*' -o -name 'libGraphicsMagick*' \) -print -quit)"

USER evalapp

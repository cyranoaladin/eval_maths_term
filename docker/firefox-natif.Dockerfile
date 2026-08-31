# syntax=docker/dockerfile:1
#
# Un Firefox de série, pour éprouver ce que Playwright ne peut pas éprouver.
#
# Le Firefox qu'embarque Playwright est une variante corrigée : elle porte
# `juggler`, le protocole d'automatisation maison, et c'est précisément lui
# qui se perd lorsque `Cross-Origin-Opener-Policy: same-origin` fait échanger
# à Gecko son groupe de contextes de navigation. L'éprouver avec lui ne
# prouverait rien.
#
# Cette image contient donc le Firefox ESR de Debian, tel qu'il est publié,
# et Node pour lancer `scripts/smoke-firefox-coop.mjs` — qui parle Marionette,
# le protocole de Gecko lui-même, sans geckodriver ni WebDriver.
ARG NODE_IMAGE=node@sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284
FROM ${NODE_IMAGE}

RUN apt-get update && apt-get install -y --no-install-recommends \
      firefox-esr \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 # Le script appelle `firefox` ; Debian installe `firefox-esr`.
 && ln -sf /usr/bin/firefox-esr /usr/bin/firefox \
 && firefox --version

WORKDIR /app

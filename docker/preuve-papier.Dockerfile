# syntax=docker/dockerfile:1
#
# L'environnement reproductible de la preuve papier.
#
# La régression visuelle des sujets — écriture arabe comprise — compare des
# rendus raster à des références versionnées. Un raster n'est comparable
# octet à octet que si poppler est le même partout : cette image fige
# l'outillage (pdftoppm, pdftotext, pdfinfo, pdffonts) sur la même base
# Debian épinglée que l'image de production.
#
# Elle ne contient ni le produit, ni TeX : elle lit des PDF, rien d'autre.
ARG NODE_IMAGE=node@sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284
FROM ${NODE_IMAGE}
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils \
 && rm -rf /var/lib/apt/lists/*

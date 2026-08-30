# syntax=docker/dockerfile:1
#
# Image de production — construction en deux étapes.
# L'étape de build embarque les outils (TypeScript, Vite, esbuild) ; l'image
# finale ne contient que le nécessaire à l'exécution.
#
# AMC n'est pas dans cette image : `auto-multiple-choice` tire une chaîne
# LaTeX complète de plusieurs gigaoctets. L'impression est donc indisponible
# tant qu'il n'est pas installé — l'interface le signale au lieu d'échouer.
# Voir DEPLOYMENT.md pour la variante avec impression.

# ── Construction ─────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# Dépendances de production uniquement, pour l'image finale.
RUN npm prune --omit=dev

# ── Exécution ────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Utilisateur non privilégié : le processus n'a aucune raison d'être root.
RUN useradd --system --create-home --uid 10001 evalapp

COPY --from=builder --chown=evalapp:evalapp /app/dist ./dist
COPY --from=builder --chown=evalapp:evalapp /app/node_modules ./node_modules
COPY --from=builder --chown=evalapp:evalapp /app/package.json ./package.json
COPY --from=builder --chown=evalapp:evalapp /app/db ./db
COPY --from=builder --chown=evalapp:evalapp /app/drizzle.config.ts ./drizzle.config.ts

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

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/boot.js"]

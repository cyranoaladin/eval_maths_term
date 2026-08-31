import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    inspectAttr(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    /*
      Le seuil d'avertissement de Rollup est aveugle : il range dans le même
      sac un fichier chargé à la demande et un fichier imposé à chaque
      visiteur. Le seul qui dépasse ici est MathLive — 828 ko, chargés
      uniquement par qui saisit une formule.

      Le seuil est donc porté juste au-dessus, et pas plus : MathLive qui
      grossirait de vingt kilo-octets le ferait réapparaître, et tout autre
      fichier volumineux aussi. Le vrai contrôle est ailleurs, dans
      `scripts/verifier-budget-chargement.mjs`, qui mesure ce qu'un élève
      télécharge avant de voir sa première question et refuse qu'une
      bibliothèque lourde s'invite au premier rendu.
    */
    chunkSizeWarningLimit: 850,
    rollupOptions: {
      output: {
        /**
         * Bibliothèques lourdes isolées : elles changent rarement et restent
         * donc en cache du navigateur entre deux déploiements, au lieu d'être
         * retéléchargées avec le code applicatif.
         *
         * MathLive n'est pas ici, et c'est le point. `MathInput` la charge par
         * `import("mathlive")`, précisément pour ne pas l'imposer à qui ne
         * saisit pas de formule — un élève qui coche des cases, par exemple.
         * La nommer dans un groupe la faisait retomber dans le même fichier
         * que KaTeX, que presque toute page importe : les 700 ko de MathLive
         * repartaient donc au premier rendu, et le chargement différé ne
         * servait à rien. Rollup lui donne son propre fichier si on la laisse
         * tranquille.
         *
         * `mathjs` n'y est pas non plus : elle ne sert qu'à la correction, côté
         * serveur. Elle était nommée ici sans qu'aucun module client ne
         * l'importe — sans effet, mais trompeur pour qui lit ce fichier.
         */
        /*
          Par chemin de module plutôt que par liste de noms : la liste était à
          tenir à jour à chaque dépendance ajoutée ou retirée, et un nom absent
          fait échouer la construction sur « Could not resolve entry module ».
        */
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          const dans = (...noms: string[]) =>
            noms.some((n) => id.includes(`node_modules/${n}`));

          if (dans("react-router", "react-dom", "react/", "scheduler")) return "vendor-react";
          if (dans("katex")) return "vendor-katex";
          // Les briques d'interface et le transport de données : elles pèsent,
          // elles ne bougent qu'aux montées de version, et elles étaient
          // jusqu'ici mêlées au code applicatif — chaque déploiement les
          // faisait retélécharger en entier.
          if (dans("@radix-ui", "lucide-react", "class-variance-authority", "clsx", "tailwind-merge"))
            return "vendor-ui";
          if (dans("@trpc", "@tanstack", "superjson", "zod")) return "vendor-data";
          return;
        },
      },
    },
  },
});

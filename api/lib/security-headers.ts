/**
 * api/lib/security-headers.ts
 *
 * En-têtes de sécurité, posés sur toute réponse.
 *
 * Aucun n'était présent : ni politique de contenu, ni interdiction
 * d'encadrement, ni consigne de cache. Une page d'évaluation pouvait être
 * chargée dans une iframe d'un site tiers, et un relevé de notes rester dans
 * le cache d'un navigateur partagé — celui du CDI, par exemple.
 *
 * La politique de contenu est stricte en production, où le bundle ne contient
 * ni script en ligne ni évaluation dynamique. En développement, Vite injecte
 * son client de rechargement à chaud et a besoin d'`unsafe-inline` et
 * d'`unsafe-eval` : la politique y est desserrée, et c'est la production qui
 * est éprouvée.
 */
import type { MiddlewareHandler } from "hono";
import { env } from "./env";

/**
 * `style-src` autorise l'inline : KaTeX et MathLive posent des styles calculés
 * sur les éléments qu'ils produisent, et le rendu des formules en dépend.
 * `script-src`, lui, ne l'autorise pas — c'est celui qui compte.
 */
const POLITIQUE_PRODUCTION = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

/**
 * `upgrade-insecure-requests` n'a de sens que sur un déploiement en https.
 * Sur une adresse en clair — la boucle locale de la recette d'image, par
 * exemple — WebKit tente de charger les fichiers du bundle en https, échoue, et
 * n'affiche rien du tout. La directive suit donc l'adresse publique déclarée.
 */
const POLITIQUE_PRODUCTION_HTTPS = `${POLITIQUE_PRODUCTION}; upgrade-insecure-requests`;

const POLITIQUE_DEVELOPPEMENT = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Rien de tout cela n'est utilisé : autant le refuser explicitement. */
const PERMISSIONS = [
  "accelerometer=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
  "interest-cohort=()",
].join(", ");

/**
 * Les fichiers produits par le build portent une empreinte dans leur nom, sous
 * la forme `nom-EMPREINTE.ext`. Le motif attendait un point avant l'empreinte
 * là où Vite met un tiret : plus rien n'était mis en cache, et chaque
 * navigation retéléchargeait la totalité du bundle — police mathématique
 * comprise. Sur le réseau d'un établissement, au démarrage d'une épreuve,
 * c'est exactement le moment où il ne faut pas.
 */
const ACTIF_VERSIONNE = /^\/assets\/[^/]+-[0-9a-zA-Z_-]{8,}\.[a-z0-9]+$/;

/** Les polices de MathLive sont servies telles quelles, sans empreinte. */
const POLICE_MATHLIVE = /^\/mathlive\/fonts\/[^/]+\.(woff2?|ttf|otf)$/;

function politiqueApplicable(): string {
  if (!env.isProduction) return POLITIQUE_DEVELOPPEMENT;
  return env.publicBaseUrl.startsWith("https://")
    ? POLITIQUE_PRODUCTION_HTTPS
    : POLITIQUE_PRODUCTION;
}

export function enTetesDeSecurite(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    c.header("Content-Security-Policy", politiqueApplicable());
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("Permissions-Policy", PERMISSIONS);
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Cross-Origin-Resource-Policy", "same-origin");

    // HSTS n'est honoré que sur une connexion sécurisée ; l'émettre ailleurs
    // n'apporte rien et brouille la lecture d'un diagnostic.
    if (env.isProduction && env.publicBaseUrl.startsWith("https://")) {
      c.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }

    /*
      Cache. Tout ce qui vient de l'application est personnel — copies, notes,
      identités — et n'a rien à faire dans le cache d'un poste partagé. Seuls
      les fichiers produits par le build, dont le nom porte une empreinte de
      contenu, sont mis en cache durablement.
    */
    const chemin = new URL(c.req.url).pathname;
    if (ACTIF_VERSIONNE.test(chemin)) {
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    } else if (POLICE_MATHLIVE.test(chemin)) {
      // Sans empreinte dans le nom : on revalide, mais on ne retélécharge pas
      // deux mégaoctets de polices à chaque page.
      c.header("Cache-Control", "public, max-age=86400");
    } else if (!c.res.headers.has("Cache-Control")) {
      c.header("Cache-Control", "no-store");
    }
  };
}

/**
 * api/lib/base-url.ts
 *
 * D'où l'application tient sa propre adresse.
 *
 * L'URL de redirection OAuth était fabriquée à partir de l'en-tête `Host` de
 * la requête — un en-tête fourni par le client. Derrière un reverse proxy qui
 * le transmet sans le valider, il suffit d'en changer pour faire pointer la
 * redirection, donc le code d'autorisation, vers un domaine choisi.
 * `X-Forwarded-Host` a exactement le même défaut, en pire : il n'est même pas
 * censé venir du client.
 *
 * En production, l'adresse vient de `PUBLIC_BASE_URL` et de rien d'autre ;
 * `env.ts` refuse de démarrer sans elle. Hors production, elle est déduite de
 * la requête pour qu'une machine de développement fonctionne sans
 * configuration — le risque n'y existe pas, puisque rien n'y est exposé.
 */
import { env } from "./env";

export function baseUrlPublique(requete: Request): string {
  if (env.isProduction) return env.publicBaseUrl;
  if (env.publicBaseUrl !== "") return env.publicBaseUrl;

  const url = new URL(requete.url);
  return `${url.protocol}//${url.host}`;
}

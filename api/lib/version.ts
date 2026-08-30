/**
 * api/lib/version.ts
 *
 * Ce qui tourne, exactement.
 *
 * Devant une anomalie, un exploitant doit pouvoir dire quelle version répond.
 * `docker compose ps` donne un identifiant d'image, pas un commit ; le
 * `package.json` d'un dépôt local ne dit rien de ce qui est déployé. Ces deux
 * valeurs sont donc inscrites dans le binaire au moment de la construction, et
 * `/api/health` les expose.
 *
 * Elles ne sont pas des secrets : connaître la version d'un logiciel ne permet
 * pas d'y entrer, et l'ignorer ne protège personne — cela empêche seulement de
 * diagnostiquer.
 */

declare const __VERSION_APPLICATION__: string | undefined;
declare const __EMPREINTE_GIT__: string | undefined;

/**
 * Hors construction — serveur de développement, tests — les constantes ne sont
 * pas définies : on le dit plutôt que de faire croire à une version.
 */
export const VERSION_APPLICATION: string =
  typeof __VERSION_APPLICATION__ === "string" ? __VERSION_APPLICATION__ : "développement";

export const EMPREINTE_GIT: string =
  typeof __EMPREINTE_GIT__ === "string" ? __EMPREINTE_GIT__ : "développement";

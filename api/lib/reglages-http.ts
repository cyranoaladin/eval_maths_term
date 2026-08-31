/**
 * api/lib/reglages-http.ts
 *
 * Les délais du serveur HTTP, et la règle qui les fixe.
 *
 * **Un serveur doit garder ses connexions ouvertes plus longtemps que le plus
 * patient de ses clients.** C'est la seule règle ; les nombres en découlent.
 *
 * Ce qui arrive quand elle n'est pas respectée : le client réutilise une
 * connexion que le serveur vient de fermer. Sa requête part dans un tuyau clos.
 * Selon le moment exact, il reçoit une erreur de transport — une copie qui ne
 * part pas, sans trace côté serveur — ou il attend que son propre délai de
 * réponse expire, ce qui peut prendre des minutes.
 *
 * Les délais d'inactivité des clients :
 *
 * | Client | Délai avant d'abandonner une connexion inactive |
 * |---|---|
 * | Gecko (Firefox) | 115 s (`network.http.keep-alive.timeout`) |
 * | Chromium | ~60 s |
 * | WebKit | ~60 s |
 * | nginx en amont (`keepalive_timeout`) | 75 s par défaut |
 * | HAProxy (`timeout http-keep-alive`) | souvent 10 à 60 s |
 *
 * Le plus patient est Gecko, à 115 secondes. On prend au-dessus.
 *
 * Le défaut de Node est de **5 secondes**, et il a coûté une remise de copie
 * sur deux cents lors d'une mesure de charge : refusée en une milliseconde,
 * sans la moindre erreur applicative, parce que le serveur n'avait rien vu
 * passer.
 *
 * Si un répartiteur est placé devant, son propre délai d'inactivité doit rester
 * **inférieur** à `KEEP_ALIVE_MS` — sinon c'est lui qui ferme en premier, et le
 * problème revient d'un cran en amont. Voir `DEPLOYMENT.md`.
 */

/** Durée pendant laquelle une connexion inactive reste ouverte. */
export const KEEP_ALIVE_MS = 125_000;

/**
 * Délai d'arrivée des en-têtes d'une requête.
 *
 * Il doit rester au-dessus de `KEEP_ALIVE_MS`, sans quoi c'est lui qui coupe la
 * connexion inactive, et le réglage précédent ne sert à rien. Node impose déjà
 * cette relation depuis la version 18 ; on l'écrit pour qu'elle se relise.
 */
export const HEADERS_TIMEOUT_MS = KEEP_ALIVE_MS + 1_000;

/** Le plus patient des clients connus, en millisecondes. */
export const CLIENT_LE_PLUS_PATIENT_MS = 115_000;

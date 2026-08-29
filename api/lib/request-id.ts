/**
 * api/lib/request-id.ts
 *
 * Identifiant de requête, propagé sans avoir à le passer de fonction en
 * fonction.
 *
 * `AsyncLocalStorage` conserve la valeur pour toute la durée du traitement, y
 * compris à travers les `await` : le logger la retrouve seul, et les écritures
 * d'audit peuvent la rattacher sans que la couche métier ait à la connaître.
 *
 * Un identifiant fourni par l'appelant est accepté **après validation** :
 * accepter n'importe quelle chaîne permettrait d'injecter des retours à la
 * ligne dans les journaux et d'y fabriquer de fausses entrées.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { nanoid } from "nanoid";

const stockage = new AsyncLocalStorage<string>();

/** Format accepté d'un identifiant entrant : sûr à journaliser. */
const FORMAT_SUR = /^[A-Za-z0-9_-]{8,64}$/;

export const REQUEST_ID_HEADER = "x-request-id";

export function normaliserRequestId(brut: string | null | undefined): string {
  return brut && FORMAT_SUR.test(brut) ? brut : nanoid(16);
}

/** Exécute `fn` en attachant `requestId` à tout ce qu'elle déclenche. */
export function withRequestId<T>(requestId: string, fn: () => T): T {
  return stockage.run(requestId, fn);
}

/** Identifiant courant, ou `undefined` hors d'une requête (tâches de fond, tests). */
export function currentRequestId(): string | undefined {
  return stockage.getStore();
}

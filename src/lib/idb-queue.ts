/**
 * src/lib/idb-queue.ts
 *
 * File d'attente FIFO légère basée sur idb-keyval.
 * Utilisée par useAutoSave pour les drafts offline.
 *
 * Contrat :
 * - enqueue(item) : ajoute en fin de file.
 * - dequeueAll() : vide la file et retourne les items.
 * - size() : nombre d'items en attente.
 *
 * Safari private-mode : IndexedDB n'est pas disponible.
 * Toutes les opérations sont silencieusement dégradées vers un tableau en mémoire.
 */
import { get, set, del, keys, createStore } from "idb-keyval";

const STORE_NAME = "autosave-queue";

let idbStore: ReturnType<typeof createStore> | null = null;
let memFallback: Array<{ key: string; value: unknown }> = [];
let idbAvailable = true;

function getStore() {
  if (!idbStore) {
    idbStore = createStore("eval-anticheat", STORE_NAME);
  }
  return idbStore;
}

/**
 * Tente d'initialiser IDB. Si ça échoue (Safari private), bascule sur mémoire.
 */
async function initIdb(): Promise<void> {
  try {
    await keys(getStore());
  } catch {
    idbAvailable = false;
  }
}

let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (!initPromise) initPromise = initIdb();
  return initPromise;
}

function nowKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function enqueue<T>(item: T): Promise<void> {
  await ensureInit();
  if (!idbAvailable) {
    memFallback.push({ key: nowKey(), value: item });
    return;
  }
  try {
    await set(nowKey(), item, getStore());
  } catch {
    memFallback.push({ key: nowKey(), value: item });
  }
}

export async function dequeueAll<T>(): Promise<T[]> {
  await ensureInit();
  if (!idbAvailable) {
    const items = memFallback.map((e) => e.value as T);
    memFallback = [];
    return items;
  }
  try {
    const ks = await keys(getStore());
    const items: T[] = [];
    for (const k of ks) {
      const v = await get<T>(k as string, getStore());
      if (v !== undefined) items.push(v);
      await del(k as string, getStore());
    }
    return items;
  } catch {
    return [];
  }
}

export async function size(): Promise<number> {
  await ensureInit();
  if (!idbAvailable) return memFallback.length;
  try {
    const ks = await keys(getStore());
    return ks.length;
  } catch {
    return 0;
  }
}

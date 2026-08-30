/**
 * api/rag/rag-provider.ts
 *
 * Port de recherche documentaire pour ancrer la génération de questions dans
 * vos propres supports de cours.
 *
 * Pourquoi une interface plutôt qu'un appel direct. Le service `nexusrag` ne
 * démarre pas actuellement (`release manifest unavailable or invalid`), et son
 * endpoint `/search/v2` exige une identité signée avec périmètre — niveau,
 * voie, matière — plus des barrières « fail-closed ». Lier la génération à
 * cette API aujourd'hui reviendrait à la rendre indisponible en même temps que
 * lui. Le port permet de câbler le vrai service quand il sera réparé, sans
 * toucher à la génération.
 *
 * `HttpRagProvider` vise le contrat v1 (`POST /search`, en-tête `x-api-key`,
 * réponse de forme Chroma), le seul implémentable sans la machinerie
 * d'identité signée.
 *
 * Défaut : `NullRagProvider`, qui ne retourne rien. La génération fonctionne
 * alors sans ancrage documentaire, ce qui est le comportement actuel.
 */
import { env } from "../lib/env";
import { logger } from "../lib/logger";

export interface RagPassage {
  /** Référence citable, affichée à l'enseignant : « Chapitre 4, p. 12 ». */
  source: string;
  text: string;
  /** Score de pertinence quand le service en fournit un. */
  score?: number;
}

export interface RagProvider {
  readonly name: string;
  /** Vrai si le port est réellement branché sur un service. */
  readonly available: boolean;
  search(query: string, k: number): Promise<RagPassage[]>;
}

/** Port débranché : aucune recherche, aucun échec. */
export class NullRagProvider implements RagProvider {
  readonly name = "aucun";
  readonly available = false;
  async search(): Promise<RagPassage[]> {
    return [];
  }
}

export interface HttpRagConfig {
  baseUrl: string;
  apiKey?: string;
  collection: string;
  timeoutMs?: number;
}

/** Réponse de forme Chroma renvoyée par le contrat v1. */
interface ChromaLikeResponse {
  documents?: string[][] | string[];
  metadatas?: Array<Record<string, unknown>>[] | Array<Record<string, unknown>>;
  distances?: number[][] | number[];
}

function flatten<T>(v: T[][] | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v[0]) ? (v[0] as T[]) : (v as T[]);
}

/** Construit une référence lisible à partir des métadonnées disponibles. */
function libelleSource(meta: Record<string, unknown> | undefined, index: number): string {
  if (!meta) return `Extrait ${index + 1}`;
  const candidats = ["title", "titre", "source", "document", "file", "path", "chapitre"];
  for (const c of candidats) {
    const v = meta[c];
    if (typeof v === "string" && v.trim()) {
      const page = meta.page ?? meta.pages;
      return page ? `${v.trim()}, p. ${String(page)}` : v.trim();
    }
  }
  return `Extrait ${index + 1}`;
}

export class HttpRagProvider implements RagProvider {
  readonly name = "http";
  readonly available = true;
  private readonly config: HttpRagConfig;

  constructor(config: HttpRagConfig) {
    this.config = config;
  }

  async search(query: string, k: number): Promise<RagPassage[]> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.config.timeoutMs ?? 10_000);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.config.apiKey) headers["x-api-key"] = this.config.apiKey;

      const r = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/search`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          q: query,
          collection: this.config.collection,
          k,
          include_documents: true,
        }),
        signal: ctrl.signal,
      });

      if (!r.ok) {
        throw new Error(`RAG HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
      }

      const data = (await r.json()) as ChromaLikeResponse;
      const documents = flatten<string>(data.documents);
      const metadatas = flatten<Record<string, unknown>>(data.metadatas);
      const distances = flatten<number>(data.distances);

      return documents.map((text, i) => ({
        source: libelleSource(metadatas[i], i),
        text,
        score: typeof distances[i] === "number" ? 1 - distances[i] : undefined,
      }));
    } finally {
      clearTimeout(timer);
    }
  }
}

let instance: RagProvider | null = null;

/**
 * Fournisseur courant, déduit de l'environnement.
 * Sans `RAG_URL`, on retombe sur le port débranché — jamais d'erreur.
 */
export function getRagProvider(): RagProvider {
  if (instance) return instance;

  const baseUrl = env.rag.url?.trim();
  if (!baseUrl) {
    instance = new NullRagProvider();
    return instance;
  }

  instance = new HttpRagProvider({
    baseUrl,
    apiKey: env.rag.apiKey,
    collection: env.rag.collection,
    timeoutMs: env.rag.timeoutMs,
  });
  logger.info("[rag] Fournisseur HTTP configuré", { baseUrl });
  return instance;
}

/** Remplace le fournisseur — réservé aux tests. */
export function setRagProvider(p: RagProvider | null): void {
  instance = p;
}

/**
 * Recherche tolérante aux pannes : une indisponibilité du RAG ne doit jamais
 * empêcher de rédiger des questions, seulement les priver d'ancrage.
 */
export async function searchContext(query: string, k = 5): Promise<RagPassage[]> {
  const provider = getRagProvider();
  if (!provider.available) return [];

  try {
    return await provider.search(query, k);
  } catch (e) {
    logger.warn("[rag] Recherche échouée — génération sans ancrage", {
      error: String(e).slice(0, 200),
    });
    return [];
  }
}

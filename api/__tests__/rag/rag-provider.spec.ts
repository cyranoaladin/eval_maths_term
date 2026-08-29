/**
 * Port de recherche documentaire.
 *
 * L'exigence tenue ici : une panne du RAG dégrade la génération — elle perd
 * son ancrage — mais ne l'empêche jamais. Le service visé est justement
 * indisponible aujourd'hui.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HttpRagProvider,
  NullRagProvider,
  searchContext,
  setRagProvider,
  type RagPassage,
  type RagProvider,
} from "../../rag/rag-provider";

afterEach(() => {
  setRagProvider(null);
  vi.restoreAllMocks();
});

describe("NullRagProvider", () => {
  it("ne retourne rien et ne se déclare pas disponible", async () => {
    const p = new NullRagProvider();
    expect(p.available).toBe(false);
    expect(await p.search()).toEqual([]);
  });
});

describe("HttpRagProvider", () => {
  function mockReponse(body: unknown, ok = true, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok,
      status,
      text: async () => JSON.stringify(body),
      json: async () => body,
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const provider = () =>
    new HttpRagProvider({ baseUrl: "http://rag.test/", collection: "maths", apiKey: "cle" });

  it("interroge /search avec la collection et la clé", async () => {
    const f = mockReponse({ documents: [[]], metadatas: [[]], distances: [[]] });
    await provider().search("suites géométriques", 3);

    const [url, init] = f.mock.calls[0];
    expect(url).toBe("http://rag.test/search");
    expect(init.headers["x-api-key"]).toBe("cle");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ q: "suites géométriques", collection: "maths", k: 3 });
  });

  it("aplatit la réponse de forme Chroma", async () => {
    mockReponse({
      documents: [["Pour tout $x>0$, $\\ln(x^a)=a\\ln(x)$.", "Second extrait."]],
      metadatas: [[{ title: "Chapitre 4", page: 12 }, { source: "Fiche M3" }]],
      distances: [[0.1, 0.4]],
    });

    const r = await provider().search("logarithme", 2);
    expect(r).toHaveLength(2);
    expect(r[0].source).toBe("Chapitre 4, p. 12");
    expect(r[0].text).toMatch(/ln\(x\^a\)/);
    expect(r[0].score).toBeCloseTo(0.9);
    expect(r[1].source).toBe("Fiche M3");
  });

  it("accepte aussi une réponse déjà plate", async () => {
    mockReponse({ documents: ["Un seul extrait."], metadatas: [{ titre: "Cours" }] });
    const r = await provider().search("q", 1);
    expect(r).toHaveLength(1);
    expect(r[0].source).toBe("Cours");
  });

  it("nomme les extraits sans métadonnées exploitables", async () => {
    mockReponse({ documents: [["texte"]], metadatas: [[{ inconnu: 1 }]] });
    const r = await provider().search("q", 1);
    expect(r[0].source).toBe("Extrait 1");
  });

  it("remonte une erreur HTTP", async () => {
    mockReponse({ detail: "collection inconnue" }, false, 404);
    await expect(provider().search("q", 1)).rejects.toThrow(/RAG HTTP 404/);
  });
});

describe("searchContext — tolérance aux pannes", () => {
  it("retourne une liste vide quand le port est débranché", async () => {
    setRagProvider(new NullRagProvider());
    expect(await searchContext("suites")).toEqual([]);
  });

  it("absorbe une panne du service au lieu de la propager", async () => {
    // Le service nexusrag boucle actuellement sur un crash au démarrage :
    // la rédaction de questions doit rester possible.
    const enPanne: RagProvider = {
      name: "test",
      available: true,
      search: async () => {
        throw new Error("release manifest unavailable or invalid");
      },
    };
    setRagProvider(enPanne);
    await expect(searchContext("suites")).resolves.toEqual([]);
  });

  it("transmet les extraits quand le service répond", async () => {
    const passages: RagPassage[] = [{ source: "Chapitre 2", text: "énoncé du théorème" }];
    setRagProvider({ name: "test", available: true, search: async () => passages });
    expect(await searchContext("TVI", 5)).toEqual(passages);
  });

  it("transmet la requête et le nombre d'extraits demandés", async () => {
    const vues: Array<[string, number]> = [];
    setRagProvider({
      name: "test",
      available: true,
      search: async (q, k) => { vues.push([q, k]); return []; },
    });
    await searchContext("dérivation", 3);
    expect(vues).toEqual([["dérivation", 3]]);
  });
});

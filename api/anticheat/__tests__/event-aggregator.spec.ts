import { describe, it, expect, vi, beforeEach } from "vitest";
import { ingestEvents } from "../event-aggregator";

// Mock getDb
vi.mock("../../queries/connection", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../../queries/connection";

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
};

// Chainable query builder mock
function makeSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

function makeInsertChain() {
  return {
    values: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (getDb as ReturnType<typeof vi.fn>).mockReturnValue(mockDb);
});

describe("ingestEvents", () => {
  it("insère un événement non-dupliqué et retourne accepted=1", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([])); // pas de doublon
    mockDb.insert.mockReturnValue(makeInsertChain());

    const result = await ingestEvents(1, [
      { type: "tab_switch", timestamp: Date.now(), count: 1 },
    ]);

    expect(result.accepted).toBe(1);
    expect(result.deduplicated).toBe(0);
    expect(mockDb.insert).toHaveBeenCalledOnce();
  });

  it("dédoublonne un événement récent et retourne deduplicated=1", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([{ id: 42 }])); // doublon trouvé

    const result = await ingestEvents(1, [
      { type: "blur", timestamp: Date.now(), count: 1 },
    ]);

    expect(result.accepted).toBe(0);
    expect(result.deduplicated).toBe(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("traite un batch mixte : 1 nouveau + 1 doublon", async () => {
    // Premier appel select : pas de doublon, deuxième : doublon
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([{ id: 99 }]));
    mockDb.insert.mockReturnValue(makeInsertChain());

    const result = await ingestEvents(2, [
      { type: "copy",  timestamp: Date.now() - 100 },
      { type: "paste", timestamp: Date.now() - 50 },
    ]);

    expect(result.accepted).toBe(1);
    expect(result.deduplicated).toBe(1);
  });

  it("retourne accepted=0, deduplicated=0 pour un batch vide", async () => {
    const result = await ingestEvents(1, []);
    expect(result.accepted).toBe(0);
    expect(result.deduplicated).toBe(0);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("passe le count et les métadonnées dans la valeur insérée", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([]));
    const insertValues = vi.fn().mockResolvedValue(undefined);
    mockDb.insert.mockReturnValue({ values: insertValues });

    const ts = Date.now();
    await ingestEvents(3, [
      { type: "devtools_open", timestamp: ts, count: 5, metadata: { method: "debugger-trap" } },
    ]);

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 3,
        type: "devtools_open",
        metadata: expect.objectContaining({ count: 5, method: "debugger-trap" }),
      }),
    );
  });

  it("utilise count=1 par défaut si omis", async () => {
    mockDb.select.mockReturnValue(makeSelectChain([]));
    const insertValues = vi.fn().mockResolvedValue(undefined);
    mockDb.insert.mockReturnValue({ values: insertValues });

    await ingestEvents(1, [{ type: "fullscreen_exit", timestamp: Date.now() }]);

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ count: 1 }) }),
    );
  });
});

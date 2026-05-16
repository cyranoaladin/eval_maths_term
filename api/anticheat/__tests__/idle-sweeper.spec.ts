import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../queries/connection", () => ({ getDb: vi.fn() }));
vi.mock("../auto-submit", () => ({
  autoSubmitSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { runIdleSweep } from "../idle-sweeper";
import { getDb } from "../../queries/connection";
import { autoSubmitSession } from "../auto-submit";
import { AUTO_SUBMIT_THRESHOLD_MS, IDLE_THRESHOLD_MS } from "@contracts/anticheat-config";

const NOW = 1_700_000_000_000;

function makeSelectChain(rows: object[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(NOW);
});

describe("runIdleSweep", () => {
  it("retourne 0 pour tout si aucune session candidate", async () => {
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue(makeSelectChain([])),
    });

    const r = await runIdleSweep();
    expect(r).toEqual({ checked: 0, warned: 0, autoSubmitted: 0, errors: 0 });
  });

  it("émet un warning pour une session idle entre 60s et 180s", async () => {
    const idleMs = IDLE_THRESHOLD_MS + 1000;
    const hbAt = new Date(NOW - idleMs);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue(makeSelectChain([{ id: 1, lastHeartbeatAt: hbAt }])),
    });

    const r = await runIdleSweep();
    expect(r.warned).toBe(1);
    expect(r.autoSubmitted).toBe(0);
    expect(autoSubmitSession).not.toHaveBeenCalled();
  });

  it("déclenche l'auto-submit pour une session idle ≥ 180s", async () => {
    const idleMs = AUTO_SUBMIT_THRESHOLD_MS + 1000;
    const hbAt = new Date(NOW - idleMs);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue(makeSelectChain([{ id: 2, lastHeartbeatAt: hbAt }])),
    });

    const r = await runIdleSweep();
    expect(r.autoSubmitted).toBe(1);
    expect(autoSubmitSession).toHaveBeenCalledWith(2, { reason: "idle_disconnect" });
  });

  it("comptabilise les erreurs d'auto-submit sans crasher", async () => {
    const idleMs = AUTO_SUBMIT_THRESHOLD_MS + 5000;
    const hbAt = new Date(NOW - idleMs);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue(makeSelectChain([{ id: 3, lastHeartbeatAt: hbAt }])),
    });
    (autoSubmitSession as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("DB error"),
    );

    const r = await runIdleSweep();
    expect(r.errors).toBe(1);
    expect(r.autoSubmitted).toBe(0);
  });

  it("traite plusieurs sessions dans le bon bucket", async () => {
    const warnHbAt   = new Date(NOW - IDLE_THRESHOLD_MS - 1000);
    const submitHbAt = new Date(NOW - AUTO_SUBMIT_THRESHOLD_MS - 1000);
    (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnValue(
        makeSelectChain([
          { id: 10, lastHeartbeatAt: warnHbAt   },
          { id: 11, lastHeartbeatAt: submitHbAt  },
        ]),
      ),
    });

    const r = await runIdleSweep();
    expect(r.checked).toBe(2);
    expect(r.warned).toBe(1);
    expect(r.autoSubmitted).toBe(1);
  });
});

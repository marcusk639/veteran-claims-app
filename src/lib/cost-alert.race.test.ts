import { describe, it, expect, beforeEach, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

// In-memory model of the `cost_alert_state` singleton row. The `returning`
// implementation below has no `await` between reading and writing
// `lastAlertedAt` -- it runs to completion synchronously once invoked, which
// is what makes it a faithful model of a real Postgres
// `INSERT ... ON CONFLICT DO UPDATE ... WHERE ... RETURNING`: that statement
// is one indivisible operation from Postgres's perspective, so two
// concurrent callers can never both observe "cooldown elapsed" before either
// writes. A real DB integration test can't reliably force this interleaving
// (verified: the underlying HTTP transport serializes "concurrent" calls to
// the same connection in practice), so this mock reproduces the race
// deterministically instead.
let lastAlertedAt: number | null = null;
const COOLDOWN_MS = 60 * 60_000;

vi.mock("@/db", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [{ total: "1.2" }] }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: (config: { setWhere?: unknown }) => ({
          returning: async () => {
            if (config.setWhere === undefined) {
              throw new Error(
                "checkCostAlert's cooldown gate must pass setWhere -- an " +
                  "unconditional onConflictDoUpdate cannot prevent concurrent " +
                  "callers from both seeing 'cooldown elapsed' before either writes.",
              );
            }
            const now = Date.now();
            const cooldownOk =
              lastAlertedAt === null || now - lastAlertedAt > COOLDOWN_MS;
            if (!cooldownOk) return [];
            lastAlertedAt = now;
            return [{ id: "singleton" }];
          },
        }),
      }),
    }),
  },
}));

vi.stubGlobal("fetch", fetchMock);

import { checkCostAlert } from "./cost-alert";

describe("checkCostAlert cooldown race", () => {
  beforeEach(() => {
    lastAlertedAt = null;
    fetchMock.mockReset().mockResolvedValue({ ok: true } as Response);
    process.env.COST_ALERT_THRESHOLD_USD = "1.00";
    process.env.COST_ALERT_WEBHOOK_URL = "http://localhost:9999/webhook";
  });

  it("fires the alert webhook at most once when two over-threshold checks race concurrently", async () => {
    await Promise.all([checkCostAlert(60), checkCostAlert(60)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fires again after the cooldown window has elapsed", async () => {
    await checkCostAlert(60);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    lastAlertedAt = Date.now() - (COOLDOWN_MS + 1000);
    await checkCostAlert(60);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

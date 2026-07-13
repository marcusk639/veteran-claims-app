import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { recordMessageCost, checkCostAlert } from "./cost-alert";

// Neon's HTTP driver (drizzle-orm/neon-http) issues DB queries via the global
// `fetch`, so stubbing it wholesale breaks every db.execute/insert call (and
// makes `fetch` register as "called" for every query, not just the webhook
// alert). The mock below delegates DB-bound requests to the real fetch and
// routes only webhook-URL requests through a dedicated `webhookFetch` spy,
// which is what the assertions below check.
const realFetch = global.fetch;
let webhookFetch: ReturnType<
  typeof vi.fn<(...args: unknown[]) => Promise<Response>>
>;

describe("cost alert", () => {
  beforeEach(async () => {
    await db.execute(
      sql`DELETE FROM message_costs WHERE user_id LIKE 'test-cost-%'`,
    );
    await db.execute(sql`DELETE FROM cost_alert_state`);
    process.env.COST_ALERT_THRESHOLD_USD = "1.00";
    process.env.COST_ALERT_WEBHOOK_URL = "http://localhost:9999/webhook";
    webhookFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === process.env.COST_ALERT_WEBHOOK_URL) {
          return webhookFetch(input, init);
        }
        return realFetch(input, init);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not alert when total cost is under the threshold", async () => {
    await recordMessageCost("test-cost-a", 0.1);
    const result = await checkCostAlert(60);
    expect(result.alert).toBe(false);
    expect(webhookFetch).not.toHaveBeenCalled();
  });

  it("alerts via webhook when total cost crosses the threshold", async () => {
    await recordMessageCost("test-cost-a", 0.6);
    await recordMessageCost("test-cost-b", 0.6);
    const result = await checkCostAlert(60);
    expect(result.alert).toBe(true);
    expect(result.totalUsd).toBeCloseTo(1.2, 5);
    expect(webhookFetch).toHaveBeenCalledWith(
      "http://localhost:9999/webhook",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

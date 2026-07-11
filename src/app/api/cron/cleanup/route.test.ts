import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rateLimitWindows, usageCounters, messageCosts } from "@/db/schema";

describe("GET /api/cron/cleanup", () => {
  const ORIGINAL_ENV = process.env;
  const testKey = "cron-cleanup-test-key";
  const testUserId = "cron-cleanup-test-user";

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, CRON_SECRET: "test-cron-secret" };
  });

  afterEach(async () => {
    process.env = ORIGINAL_ENV;
    await db.delete(rateLimitWindows).where(eq(rateLimitWindows.key, testKey));
    await db.delete(usageCounters).where(eq(usageCounters.userId, testUserId));
    await db.delete(messageCosts).where(eq(messageCosts.userId, testUserId));
  });

  it("rejects requests without a valid CRON_SECRET bearer token", async () => {
    const { GET } = await import("./route");

    const noHeader = await GET(
      new Request("http://localhost/api/cron/cleanup"),
    );
    expect(noHeader.status).toBe(401);

    const wrongHeader = await GET(
      new Request("http://localhost/api/cron/cleanup", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );
    expect(wrongHeader.status).toBe(401);
  });

  it("deletes stale rows across all tracked tables and keeps recent ones", async () => {
    const now = new Date();
    const oldRateLimitWindow = new Date(
      now.getTime() - 2 * 24 * 60 * 60 * 1000,
    );
    const recentRateLimitWindow = new Date(now.getTime() - 60 * 60 * 1000);
    const oldUsagePeriod = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);
    const recentUsagePeriod = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const oldCost = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000);
    const recentCost = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

    await db.insert(rateLimitWindows).values([
      { key: testKey, windowStart: oldRateLimitWindow, count: 1 },
      { key: testKey, windowStart: recentRateLimitWindow, count: 1 },
    ]);
    await db.insert(usageCounters).values([
      {
        userId: testUserId,
        feature: "old-feature",
        periodStart: oldUsagePeriod,
        count: 1,
      },
      {
        userId: testUserId,
        feature: "recent-feature",
        periodStart: recentUsagePeriod,
        count: 1,
      },
    ]);
    await db.insert(messageCosts).values([
      { userId: testUserId, costUsd: "1.000000", createdAt: oldCost },
      { userId: testUserId, costUsd: "2.000000", createdAt: recentCost },
    ]);

    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/cron/cleanup", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });

    const remainingRateLimitWindows = await db
      .select()
      .from(rateLimitWindows)
      .where(eq(rateLimitWindows.key, testKey));
    expect(remainingRateLimitWindows).toHaveLength(1);
    expect(remainingRateLimitWindows[0].windowStart).toEqual(
      recentRateLimitWindow,
    );

    const remainingUsageCounters = await db
      .select()
      .from(usageCounters)
      .where(eq(usageCounters.userId, testUserId));
    expect(remainingUsageCounters).toHaveLength(1);
    expect(remainingUsageCounters[0].feature).toBe("recent-feature");

    const remainingMessageCosts = await db
      .select()
      .from(messageCosts)
      .where(eq(messageCosts.userId, testUserId));
    expect(remainingMessageCosts).toHaveLength(1);
    expect(remainingMessageCosts[0].costUsd).toBe("2.000000");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { incrementUsage } from "./usage";
import { db } from "@/db";

describe("incrementUsage", () => {
  const userId = "test-user-concurrency";
  const feature = "knowledge_assistant_messages";
  const periodStart = new Date("2026-07-01T00:00:00Z");

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM usage_counters WHERE user_id = ${userId}`);
  });

  it("increments atomically under concurrent calls with no lost updates", async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        incrementUsage(userId, feature, periodStart),
      ),
    );
    const rows = await db.execute(
      sql`SELECT count FROM usage_counters WHERE user_id = ${userId} AND feature = ${feature}`,
    );
    expect(rows.rows[0].count).toBe(20);
  });
});

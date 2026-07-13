import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";

// The cron cleanup job (src/app/api/cron/cleanup/route.ts) filters
// rate_limit_windows/usage_counters by their trailing timestamp column only
// (windowStart / periodStart), which the tables' composite primary keys
// (key, windowStart) / (userId, feature, periodStart) cannot serve as a
// range-scan index for -- Postgres can only use a leading-column prefix of a
// btree. Without a dedicated index, every nightly cleanup run does a full
// table scan of the app's two hottest tables (written on every chat request).
describe("retention-cutoff column indexes", () => {
  it("has an index usable for a range scan on rate_limit_windows.window_start", async () => {
    const rows = await db.execute(
      sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'rate_limit_windows'`,
    );
    const hasLeadingIndex = rows.rows.some((row) =>
      /\(window_start[,)]/.test(String((row as { indexdef: string }).indexdef)),
    );
    expect(hasLeadingIndex).toBe(true);
  });

  it("has an index usable for a range scan on usage_counters.period_start", async () => {
    const rows = await db.execute(
      sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'usage_counters'`,
    );
    const hasLeadingIndex = rows.rows.some((row) =>
      /\(period_start[,)]/.test(String((row as { indexdef: string }).indexdef)),
    );
    expect(hasLeadingIndex).toBe(true);
  });
});

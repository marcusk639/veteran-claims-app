import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { checkRateLimit } from "./rate-limit";
import { db } from "@/db";

describe("checkRateLimit", () => {
  const key = "test-rate-limit-key";

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM rate_limit_windows WHERE key = ${key}`);
  });

  it("allows requests under the limit and blocks once the limit is exceeded", async () => {
    const limit = 3;
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await checkRateLimit(key, limit, 60));
    }
    expect(results.map((r) => r.allowed)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});

import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "./index";

describe("db connection", () => {
  it("connects to Postgres and can run a trivial query", async () => {
    const result = await db.execute(sql`SELECT 1 as value`);
    expect(result.rows[0].value).toBe(1);
  });
});

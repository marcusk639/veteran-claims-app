import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import {
  isFoundingSupporter,
  activateFoundingSupporter,
} from "./founding-supporter";
import { db } from "@/db";

describe("isFoundingSupporter", () => {
  const userId = "test-user-founding-supporter";

  beforeEach(async () => {
    await db.execute(
      sql`DELETE FROM founding_supporters WHERE user_id = ${userId}`,
    );
  });

  it("returns false for a user with no founding_supporters row", async () => {
    expect(await isFoundingSupporter(userId)).toBe(false);
  });

  it("returns true once activateFoundingSupporter has inserted a row", async () => {
    await activateFoundingSupporter(userId);
    expect(await isFoundingSupporter(userId)).toBe(true);
  });

  it("activateFoundingSupporter is idempotent for an already-active user", async () => {
    await activateFoundingSupporter(userId);
    await activateFoundingSupporter(userId);
    expect(await isFoundingSupporter(userId)).toBe(true);
  });
});

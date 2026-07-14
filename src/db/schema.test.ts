import { describe, it, expect, afterEach } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations } from "./schema";

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

// This app's code only ever writes messages.role as "user"/"assistant" and
// conversations.agent_type as "knowledge-assistant" (verified against real
// data). A free-text column can't stop a future bug or a stray manual
// UPDATE from writing something else, silently breaking the
// role === "assistant" ? ... : "user" narrowing in route.ts. A pgEnum makes
// that a DB-level constraint instead of an assumption.
describe("messages.role / conversations.agent_type enum enforcement", () => {
  const testUserId = "test-enum-user";

  afterEach(async () => {
    // Delete children before the parent conversation -- a message row
    // referencing it (even one inserted via raw SQL bypassing the app's own
    // insert helpers) would otherwise make the conversation delete fail on
    // the FK constraint and leave both rows behind.
    const testConversations = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.userId, testUserId));
    for (const conv of testConversations) {
      await db.execute(
        sql`DELETE FROM messages WHERE conversation_id = ${conv.id}`,
      );
    }
    await db.delete(conversations).where(eq(conversations.userId, testUserId));
  });

  it("rejects an invalid messages.role value at the database level", async () => {
    const [conv] = await db
      .insert(conversations)
      .values({ userId: testUserId, agentType: "knowledge-assistant" })
      .returning();

    await expect(
      db.execute(
        sql`INSERT INTO messages (conversation_id, role, content) VALUES (${conv.id}, 'bogus', 'x')`,
      ),
    ).rejects.toThrow();
  });

  it("rejects an invalid conversations.agent_type value at the database level", async () => {
    await expect(
      db.execute(
        sql`INSERT INTO conversations (user_id, agent_type) VALUES (${testUserId}, 'bogus')`,
      ),
    ).rejects.toThrow();
  });
});

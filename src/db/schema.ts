import {
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
  primaryKey,
  uuid,
  jsonb,
} from "drizzle-orm/pg-core";

export const usageCounters = pgTable(
  "usage_counters",
  {
    userId: text("user_id").notNull(),
    feature: text("feature").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.userId, table.feature, table.periodStart],
    }),
  }),
);

export const rateLimitWindows = pgTable(
  "rate_limit_windows",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.key, table.windowStart] }),
  }),
);

export interface Citation {
  source: string;
  section: string;
  snippet: string;
}

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  agentType: text("agent_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  citations: jsonb("citations").notNull().default([]).$type<Citation[]>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const messageCosts = pgTable("message_costs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

import {
  pgTable,
  text,
  integer,
  numeric,
  timestamp,
  primaryKey,
  uuid,
  jsonb,
  index,
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
    // The composite PK above is (userId, feature, periodStart) -- Postgres
    // can only use a leading-column prefix of that btree, so it can't serve
    // the retention cron's `WHERE periodStart < cutoff` range scan. Without
    // this, that cleanup does a full table scan of a table written on every
    // chat message.
    periodStartIdx: index("usage_counters_period_start_idx").on(
      table.periodStart,
    ),
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
    // Same reasoning as usage_counters above: the PK's leading column is
    // `key`, not `windowStart`, so the retention cron's `WHERE windowStart <
    // cutoff` needs its own index.
    windowStartIdx: index("rate_limit_windows_window_start_idx").on(
      table.windowStart,
    ),
  }),
);

export interface Citation {
  source: string;
  section: string;
  snippet: string;
}

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    agentType: text("agent_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdIdx: index("conversations_user_id_idx").on(table.userId),
  }),
);

export const messages = pgTable(
  "messages",
  {
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
  },
  (table) => ({
    conversationIdIdx: index("messages_conversation_id_idx").on(
      table.conversationId,
    ),
  }),
);

export const messageCosts = pgTable(
  "message_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    createdAtIdx: index("message_costs_created_at_idx").on(table.createdAt),
  }),
);

// Singleton-per-row cooldown tracker so the cost-alert webhook fires at most
// once per cooldown window instead of on every message once threshold trips.
export const costAlertState = pgTable("cost_alert_state", {
  id: text("id").primaryKey().default("singleton"),
  lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
});

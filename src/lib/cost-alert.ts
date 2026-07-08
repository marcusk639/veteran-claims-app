import { sql } from "drizzle-orm";
import { db } from "@/db";
import { messageCosts } from "@/db/schema";
import { getRequiredEnv } from "@/lib/env";

export async function recordMessageCost(
  userId: string,
  costUsd: number,
): Promise<void> {
  await db.insert(messageCosts).values({ userId, costUsd: costUsd.toString() });
}

export async function checkCostAlert(
  windowMinutes: number,
): Promise<{ totalUsd: number; alert: boolean }> {
  const result = await db.execute(
    sql`SELECT COALESCE(SUM(cost_usd), 0) AS total
        FROM message_costs
        WHERE created_at > NOW() - (${windowMinutes} || ' minutes')::interval`,
  );
  const totalUsd = Number(result.rows[0]?.total ?? 0);
  const threshold = Number(getRequiredEnv("COST_ALERT_THRESHOLD_USD"));
  const alert = totalUsd >= threshold;

  if (alert) {
    await fetch(getRequiredEnv("COST_ALERT_WEBHOOK_URL"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totalUsd, windowMinutes, threshold }),
    });
  }

  return { totalUsd, alert };
}

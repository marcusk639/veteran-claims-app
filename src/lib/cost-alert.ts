import { sql } from "drizzle-orm";
import { db } from "@/db";
import { messageCosts, costAlertState } from "@/db/schema";
import { getRequiredEnv } from "@/lib/env";

// Once the alert webhook has fired, suppress re-firing for this long even if
// the rolling-window total stays over threshold -- otherwise every message
// sent while spend remains elevated re-fires the webhook.
const ALERT_COOLDOWN_MINUTES = 60;

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

  if (alert && (await claimAlertCooldown())) {
    await fetch(getRequiredEnv("COST_ALERT_WEBHOOK_URL"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totalUsd, windowMinutes, threshold }),
    });
  }

  return { totalUsd, alert };
}

// Atomically claims the right to fire the alert webhook. A separate
// read-then-write (SELECT lastAlertedAt, decide, then INSERT/UPDATE) lets
// two concurrent callers -- exactly what happens during the traffic spike
// this alert exists to catch -- both observe "cooldown elapsed" before
// either writes, double-firing the webhook. The conditional
// `ON CONFLICT ... DO UPDATE ... WHERE` clause below is evaluated and
// applied by Postgres as a single indivisible operation against the row, so
// only one concurrent caller can ever win it.
async function claimAlertCooldown(): Promise<boolean> {
  const cooldownMs = ALERT_COOLDOWN_MINUTES * 60_000;
  const claimed = await db
    .insert(costAlertState)
    .values({ id: "singleton", lastAlertedAt: new Date() })
    .onConflictDoUpdate({
      target: costAlertState.id,
      set: { lastAlertedAt: new Date() },
      setWhere: sql`${costAlertState.lastAlertedAt} IS NULL OR ${costAlertState.lastAlertedAt} < NOW() - (${cooldownMs} || ' milliseconds')::interval`,
    })
    .returning({ id: costAlertState.id });
  return claimed.length > 0;
}

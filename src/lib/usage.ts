import { db } from "@/db";
import { usageCounters } from "@/db/schema";
import { sql } from "drizzle-orm";

export async function incrementUsage(
  userId: string,
  feature: string,
  periodStart: Date,
): Promise<number> {
  const result = await db
    .insert(usageCounters)
    .values({ userId, feature, periodStart, count: 1 })
    .onConflictDoUpdate({
      target: [
        usageCounters.userId,
        usageCounters.feature,
        usageCounters.periodStart,
      ],
      set: { count: sql`${usageCounters.count} + 1` },
    })
    .returning({ count: usageCounters.count });

  return result[0].count;
}

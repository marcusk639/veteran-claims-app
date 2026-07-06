import { db } from "@/db";
import { rateLimitWindows } from "@/db/schema";
import { sql } from "drizzle-orm";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = new Date();
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

  const result = await db
    .insert(rateLimitWindows)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitWindows.key, rateLimitWindows.windowStart],
      set: { count: sql`${rateLimitWindows.count} + 1` },
    })
    .returning({ count: rateLimitWindows.count });

  const count = result[0].count;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
  };
}

import { NextResponse } from "next/server";
import { lt } from "drizzle-orm";
import { db } from "@/db";
import { rateLimitWindows, usageCounters, messageCosts } from "@/db/schema";
import { getRequiredEnv } from "@/lib/env";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${getRequiredEnv("CRON_SECRET")}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const rateLimitCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const usageCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const costCutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  await db
    .delete(rateLimitWindows)
    .where(lt(rateLimitWindows.windowStart, rateLimitCutoff));
  await db
    .delete(usageCounters)
    .where(lt(usageCounters.periodStart, usageCutoff));
  await db.delete(messageCosts).where(lt(messageCosts.createdAt, costCutoff));

  return NextResponse.json({ status: "ok" });
}

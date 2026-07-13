import { db } from "@/db";
import { foundingSupporters } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function isFoundingSupporter(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: foundingSupporters.userId })
    .from(foundingSupporters)
    .where(eq(foundingSupporters.userId, userId));
  return row !== undefined;
}

export async function activateFoundingSupporter(userId: string): Promise<void> {
  await db.insert(foundingSupporters).values({ userId }).onConflictDoNothing();
}

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { neon } from "@neondatabase/serverless";
import { getRequiredEnv } from "@/lib/env";

config({ path: ".env.local" });

async function main() {
  const sql = neon(getRequiredEnv("DATABASE_URL"));
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied");
}

main();

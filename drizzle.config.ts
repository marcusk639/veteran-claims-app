import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { getRequiredEnv } from "./src/lib/env";

config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: getRequiredEnv("DATABASE_URL"),
  },
});

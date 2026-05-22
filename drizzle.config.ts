import { defineConfig } from "drizzle-kit";

// V1: local SQLite only. Cloud DB (Turso or similar) is a Phase 5+ concern.
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/copilot.db",
  },
});

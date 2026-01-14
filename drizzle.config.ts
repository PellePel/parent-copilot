import { defineConfig } from "drizzle-kit";

// Use Turso if credentials are provided, otherwise local SQLite
const isTurso = process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN;

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: isTurso ? "turso" : "sqlite",
  dbCredentials: isTurso
    ? {
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN!,
      }
    : {
        url: "./dev.db",
      },
});

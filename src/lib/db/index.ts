import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleLibsql } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import Database from "better-sqlite3";
import * as schema from "./schema";

function createDb() {
  // Use Turso in production, SQLite locally
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    return drizzleLibsql(client, { schema });
  }

  // Local development with SQLite
  const sqlite = new Database("dev.db");
  return drizzleSqlite(sqlite, { schema });
}

export const db = createDb();

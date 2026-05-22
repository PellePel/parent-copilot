import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema.js";

const DB_PATH = process.env.COPILOT_DB_PATH ?? "./data/copilot.db";

// Make sure the data/ directory exists before SQLite tries to open the file.
mkdirSync(dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { schema };

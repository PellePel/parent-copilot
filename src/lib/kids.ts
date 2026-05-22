import { eq, sql } from "drizzle-orm";
import { db } from "./db/index.js";
import { kids, type Kid } from "./db/schema.js";

/**
 * Find a kid by numeric id or (case-insensitive) name.
 * Throws if not found, or if a name matches multiple kids.
 */
export function findKid(identifier: string): Kid {
  const id = Number.parseInt(identifier, 10);
  if (!Number.isNaN(id) && String(id) === identifier.trim()) {
    const row = db.select().from(kids).where(eq(kids.id, id)).get();
    if (row) return row;
  }
  const matches = db
    .select()
    .from(kids)
    .where(sql`lower(${kids.name}) = lower(${identifier})`)
    .all();
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    const ids = matches.map((k) => `${k.name} (id=${k.id})`).join(", ");
    throw new Error(
      `Multiple kids named "${identifier}". Use the numeric id instead: ${ids}`,
    );
  }
  throw new Error(`No kid found matching "${identifier}"`);
}

export function listKids(): Kid[] {
  return db.select().from(kids).orderBy(kids.id).all();
}

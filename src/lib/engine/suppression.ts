/**
 * Cross-engine suppression: "has this (kidId, triggerDetail) appeared in
 * any brief within the last N weeks?"
 *
 * Used by every engine that risks repeat-firing the same item week after
 * week (developmental, absence). The query reads past brief_items joined to
 * briefs.weekOf — no new schema, no per-engine state.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { briefItems, briefs } from "../db/schema.js";

export function firedInLast(
  kidId: number,
  triggerDetail: string,
  weeksBack: number,
  asOf: string,
): boolean {
  const asOfMs = new Date(`${asOf}T00:00:00Z`).getTime();
  const cutoff = new Date(asOfMs - weeksBack * 7 * 86_400_000).toISOString().slice(0, 10);
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(briefItems)
    .innerJoin(briefs, eq(briefItems.briefId, briefs.id))
    .where(
      and(
        eq(briefItems.kidId, kidId),
        eq(briefItems.triggerDetail, triggerDetail),
        gte(briefs.weekOf, cutoff),
      ),
    )
    .get();
  return (row?.n ?? 0) > 0;
}

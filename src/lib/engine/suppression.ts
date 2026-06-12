/**
 * Cross-engine suppression: "has this (kidId, triggerDetail) appeared in
 * any brief within the last N weeks?"
 *
 * Used by every engine that risks repeat-firing the same item week after
 * week (developmental, absence). The query reads past brief_items joined to
 * briefs.weekOf — no new schema, no per-engine state.
 */

import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { briefItems, briefs } from "../db/schema.js";

/**
 * How many briefs in the last `weeksBack` weeks contained this
 * (kidId, triggerDetail). `kidId === null` matches family-level items.
 *
 * `opts.before` excludes briefs at or after that weekOf. The novelty pass
 * passes the current week so a freshly-persisted item doesn't penalize itself;
 * generation-time callers omit it (the current brief isn't persisted yet).
 */
export function recentFireCount(
  kidId: number | null,
  triggerDetail: string,
  weeksBack: number,
  asOf: string,
  opts?: { before?: string },
): number {
  const asOfMs = new Date(`${asOf}T00:00:00Z`).getTime();
  const cutoff = new Date(asOfMs - weeksBack * 7 * 86_400_000).toISOString().slice(0, 10);
  const kidCond = kidId === null ? isNull(briefItems.kidId) : eq(briefItems.kidId, kidId);
  const conds = [kidCond, eq(briefItems.triggerDetail, triggerDetail), gte(briefs.weekOf, cutoff)];
  if (opts?.before) conds.push(lt(briefs.weekOf, opts.before));
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(briefItems)
    .innerJoin(briefs, eq(briefItems.briefId, briefs.id))
    .where(and(...conds))
    .get();
  return row?.n ?? 0;
}

export function firedInLast(
  kidId: number,
  triggerDetail: string,
  weeksBack: number,
  asOf: string,
): boolean {
  return recentFireCount(kidId, triggerDetail, weeksBack, asOf) > 0;
}

/**
 * Outgrowing engine — the longitudinal half of Lookahead.
 *
 * Reads internal events + measurements and predicts which physical items the
 * kid is on track to outgrow. Three sub-modules: shoes, clothing, carseat.
 *
 * Provenance discipline: every candidate carries a `reasoning` string that
 * cites the exact data and KB band that fired it. This is R2 (surprising-but-
 * wrong) mitigation — if the brief is wrong, you can read why.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  events,
  measurements,
  type Kid,
} from "../db/schema.js";
import { ageInMonths, daysBetween, formatAge, todayIso } from "../age.js";
import {
  CLOTHING_OUTGROWING,
  shoeBandForAge,
} from "../kb/outgrowing.js";
import type { Candidate } from "./types.js";

const WEEKS_PER_MONTH = 4.345;

// =============================================================================
// Shoes
// =============================================================================

function latestShoePurchase(
  kidId: number,
): { occurredOn: string; description: string | null; metadata: Record<string, unknown> | null } | null {
  // Fetch gear_purchase events for this kid (descending by date), filter in TS.
  // Volume is tiny; querying JSON inside SQLite isn't worth the complexity yet.
  const rows = db
    .select()
    .from(events)
    .where(and(eq(events.kidId, kidId), eq(events.type, "gear_purchase")))
    .orderBy(desc(events.occurredOn))
    .all();
  const shoe = rows.find((r) => {
    const item = (r.metadata as Record<string, unknown> | null)?.item;
    return typeof item === "string" && item.toLowerCase() === "shoes";
  });
  if (!shoe) return null;
  return {
    occurredOn: shoe.occurredOn,
    description: shoe.description,
    metadata: shoe.metadata,
  };
}

export function shoeOutgrowingCandidate(kid: Kid, asOf: string = todayIso()): Candidate | null {
  const ageMonths = ageInMonths(kid.dob, asOf);
  const band = shoeBandForAge(ageMonths);
  if (!band) return null; // outside the modeled age range

  const lastPurchase = latestShoePurchase(kid.id);
  if (!lastPurchase) return null; // no history to reason from

  const daysSince = daysBetween(lastPurchase.occurredOn, asOf);
  const weeksSince = daysSince / 7;
  const flagAtWeeks = band.flagAtMonths * WEEKS_PER_MONTH;
  const overdueAtWeeks = band.overdueAtMonths * WEEKS_PER_MONTH;
  if (weeksSince < flagAtWeeks) return null;

  const isOverdue = weeksSince >= overdueAtWeeks;
  const confidence = isOverdue ? "high" : "medium";
  const rawScore = isOverdue ? 80 : 55;

  const purchaseLabel = lastPurchase.description ?? "last logged shoe purchase";
  const weeksRounded = Math.round(weeksSince);

  return {
    kidId: kid.id,
    headline: isOverdue
      ? `Check ${kid.name}'s shoes — likely overdue`
      : `Check ${kid.name}'s shoes — in the typical replacement window`,
    body:
      `It's been about ${weeksRounded} weeks since ${kid.name}'s last shoes ` +
      `(${purchaseLabel}, ${lastPurchase.occurredOn}). At ${formatAge(kid.dob, asOf)}, ` +
      `kids in this age band typically need new shoes every ${band.replaceEveryMonths} months.`,
    suggestedAction:
      "Do a quick foot check this week — press the tip of the shoe to feel for the big toe, and look for red marks on the heel or sides.",
    triggerSource: "lookahead",
    triggerDetail: "outgrowing:shoes",
    reasoning:
      `gear_purchase event on ${lastPurchase.occurredOn} (item=shoes) was ${daysSince} ` +
      `days ago. Age=${ageMonths}mo falls in shoe band ${band.ageMonthsMin}-${band.ageMonthsMax}mo ` +
      `(flag at ${band.flagAtMonths}mo, overdue at ${band.overdueAtMonths}mo). ` +
      `weeks_since=${weeksSince.toFixed(1)} vs flag=${flagAtWeeks.toFixed(1)} ` +
      `overdue=${overdueAtWeeks.toFixed(1)}. KB source: ${band.source}.`,
    confidence,
    rawScore,
  };
}

// =============================================================================
// Clothing
// =============================================================================

function latestClothingSize(kidId: number): { value: number; measuredOn: string } | null {
  const row = db
    .select()
    .from(measurements)
    .where(and(eq(measurements.kidId, kidId), eq(measurements.type, "clothing_size_months")))
    .orderBy(desc(measurements.measuredOn))
    .limit(1)
    .get();
  return row ? { value: row.value, measuredOn: row.measuredOn } : null;
}

export function clothingOutgrowingCandidate(
  kid: Kid,
  asOf: string = todayIso(),
): Candidate | null {
  const last = latestClothingSize(kid.id);
  if (!last) return null;

  const ageMonths = ageInMonths(kid.dob, asOf);
  const overageMonths = ageMonths - last.value;
  if (overageMonths < CLOTHING_OUTGROWING.flagAtOverageMonths) return null;

  const isOverdue = overageMonths >= CLOTHING_OUTGROWING.overdueAtOverageMonths;
  const confidence = isOverdue ? "high" : "medium";
  const rawScore = isOverdue ? 75 : 50;

  const sizeLabel = formatSizeMonths(last.value);
  const expectedLabel = formatSizeMonths(nextSizeUp(last.value));

  return {
    kidId: kid.id,
    headline: isOverdue
      ? `${kid.name}'s clothes are likely outgrown`
      : `${kid.name} may be aging out of ${sizeLabel} clothes`,
    body:
      `${kid.name} is ${formatAge(kid.dob, asOf)}; last logged clothing size was ${sizeLabel} ` +
      `(${last.measuredOn}). Typical fit window for that size ends around ${last.value} months, ` +
      `so they're ${overageMonths} month${overageMonths === 1 ? "" : "s"} past it.`,
    suggestedAction: `Spot-check a few items in ${sizeLabel}. If anything's tight at the shoulders, ankles, or waist, it's time to move to ${expectedLabel}.`,
    triggerSource: "lookahead",
    triggerDetail: "outgrowing:clothing",
    reasoning:
      `Latest clothing_size_months measurement: ${last.value} on ${last.measuredOn}. ` +
      `Current age=${ageMonths}mo. overage=${overageMonths}mo vs flag=${CLOTHING_OUTGROWING.flagAtOverageMonths}mo ` +
      `overdue=${CLOTHING_OUTGROWING.overdueAtOverageMonths}mo. KB source: ${CLOTHING_OUTGROWING.source}.`,
    confidence,
    rawScore,
  };
}

function formatSizeMonths(months: number): string {
  if (months >= 24 && months % 12 === 0) {
    // 24 -> 2T, 36 -> 3T, etc. (industry convention)
    return `${months / 12}T`;
  }
  return `${months}m`;
}

function nextSizeUp(months: number): number {
  const ladder = [3, 6, 9, 12, 18, 24, 36, 48, 60];
  return ladder.find((m) => m > months) ?? months + 12;
}

// =============================================================================
// Public API: all outgrowing candidates for a kid
// =============================================================================

export function outgrowingCandidatesFor(kid: Kid, asOf: string = todayIso()): Candidate[] {
  const out: Candidate[] = [];
  const shoes = shoeOutgrowingCandidate(kid, asOf);
  if (shoes) out.push(shoes);
  const clothing = clothingOutgrowingCandidate(kid, asOf);
  if (clothing) out.push(clothing);
  // carseat() lands once the user provides Jude's seat info
  return out;
}

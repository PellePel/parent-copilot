/**
 * Gear-threshold engine — forecasts gear transitions keyed to a *weight*
 * crossing, not just age. v1 covers sleep sacks (the sleep-sack-at-18lb miss
 * that prompted this engine); the model mirrors the carseat sub-module in
 * `outgrowing.ts`.
 *
 * Provenance discipline (R2): every candidate cites the exact weight reading,
 * the projection method, and the threshold it fired against.
 *
 * Suppression-only: there is no clean deterministic spine mutation for "gear
 * sized up" in the FactTarget union, so `factTarget` is left undefined. The
 * triggerDetail is namespaced `outgrowing:sleep_sack` so a "Handled"/"already
 * knew" reaction suppresses against the latest weight_kg measurement band
 * (see OUTGROWING_MEASUREMENT in reactions.ts).
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { measurements, type Kid } from "../db/schema.js";
import { ageInMonths, daysBetween, formatAge, todayIso } from "../age.js";
import { spineIdFromName } from "../context.js";
import type { Kid as ContextKid } from "../context.js";
import {
  SLEEP_SACK_KB,
  SLEEP_SACK_OUTGROWING,
  lbToKg,
  nextSleepSackThresholdKg,
} from "../kb/gear.js";
import { projectWeightForward, weeksUntilTargetWeight, WEIGHT_GAIN_KB } from "../kb/outgrowing.js";
import type { Candidate } from "./types.js";

/** The two most recent weight_kg readings (distinct dates), newest first. */
function recentWeights(kidId: number): { value: number; measuredOn: string }[] {
  return db
    .select({ value: measurements.value, measuredOn: measurements.measuredOn })
    .from(measurements)
    .where(and(eq(measurements.kidId, kidId), eq(measurements.type, "weight_kg")))
    .orderBy(desc(measurements.measuredOn))
    .limit(2)
    .all();
}

/**
 * Observed weekly weight gain (kg/week) from the two most recent readings, or
 * null when there aren't two distinct-date readings or the trend is flat /
 * negative (a bad measurement shouldn't drive a projection). AE2 wants the
 * *observed* rate to drive the crossing date when we have it.
 */
function observedWeeklyGainKg(rows: { value: number; measuredOn: string }[]): number | null {
  if (rows.length < 2) return null;
  const [newest, older] = rows as [typeof rows[number], typeof rows[number]];
  const weeks = daysBetween(older.measuredOn, newest.measuredOn) / 7;
  if (weeks <= 0) return null;
  const rate = (newest.value - older.value) / weeks;
  return rate > 0 ? rate : null;
}

/** Read a per-kid sleep-sack size-up override from the spine, in kg. */
function sleepSackOverrideKg(contextKid?: ContextKid): number | null {
  const gear = (contextKid as Record<string, unknown> | undefined)?.["gear"];
  if (typeof gear !== "object" || gear === null) return null;
  const sack = (gear as Record<string, unknown>)["sleep_sack"];
  if (typeof sack !== "object" || sack === null) return null;
  const kg = (sack as Record<string, unknown>)["size_up_at_kg"];
  if (typeof kg === "number" && kg > 0) return kg;
  const lb = (sack as Record<string, unknown>)["size_up_at_lb"];
  if (typeof lb === "number" && lb > 0) return lbToKg(lb);
  return null;
}

export function sleepSackCandidatesFor(
  kid: Kid,
  contextKid?: ContextKid,
  asOf: string = todayIso(),
): Candidate[] {
  const weights = recentWeights(kid.id);
  const latest = weights[0];
  if (!latest) return []; // no weight data, no signal

  const kidSpineId = contextKid?.id ?? kid.spineId ?? spineIdFromName(kid.name);
  const ageAtMeasurement = ageInMonths(kid.dob, latest.measuredOn);
  const weeksSinceWeighed = Math.max(0, daysBetween(latest.measuredOn, asOf) / 7);

  // Project current weight: prefer the observed slope (AE2), fall back to the
  // KB age-banded median projection when we only have one reading.
  const observedRate = observedWeeklyGainKg(weights);
  const projectedKg =
    observedRate !== null
      ? latest.value + observedRate * weeksSinceWeighed
      : projectWeightForward(latest.value, ageAtMeasurement, weeksSinceWeighed);

  // Pick the threshold from the MEASURED weight (the next size-up boundary the
  // child hasn't crossed yet). A per-kid spine override wins over the KB band.
  // Selecting from the projected weight would guarantee the weight is always
  // below the threshold, making the "reached it" case unreachable.
  const overrideKg = sleepSackOverrideKg(contextKid);
  const band = nextSleepSackThresholdKg(latest.value);
  const thresholdKg = overrideKg ?? band?.maxWeightKg ?? null;
  if (thresholdKg === null) return []; // past the largest modeled size

  const thresholdSource = overrideKg !== null ? "per-kid spine override (gear.sleep_sack)" : band!.source;
  const sizeLabel = overrideKg !== null ? "sleep sack" : `${band!.size} sleep sack`;
  const projMethod =
    observedRate !== null
      ? `observed ${observedRate.toFixed(3)} kg/week from the last two readings`
      : `KB age-banded medians (${WEIGHT_GAIN_KB.source})`;

  const ageNowMonths = ageInMonths(kid.dob, asOf);
  const staleWeeks = Math.round(weeksSinceWeighed);
  const staleNote =
    staleWeeks >= 8 ? ` Note: weight reading is ${staleWeeks} weeks old — confidence drops with stale data.` : "";

  // Weeks until the projected weight reaches the threshold. <= 0 means the
  // projection has already reached/crossed it → "size up now".
  const weeksToThreshold =
    observedRate !== null
      ? (thresholdKg - projectedKg) / observedRate
      : weeksUntilTargetWeight(projectedKg, ageNowMonths, thresholdKg);
  if (weeksToThreshold === null) return [];
  if (weeksToThreshold > SLEEP_SACK_OUTGROWING.flagWithinWeeks) return []; // too far out to flag

  const reachedNow = weeksToThreshold <= 0;
  const isImminent = weeksToThreshold <= SLEEP_SACK_OUTGROWING.highConfidenceWithinWeeks;
  const confidence = isImminent ? "high" : "medium";
  const rawScore = reachedNow ? 88 : isImminent ? 78 : 58;
  const weeksRounded = Math.max(1, Math.round(weeksToThreshold));

  const reasoning =
    `Latest weight=${latest.value}kg on ${latest.measuredOn} (kid was ${ageAtMeasurement}mo). ` +
    `Projected to ${projectedKg.toFixed(2)}kg at ${ageNowMonths}mo via ${projMethod}. ` +
    `Threshold=${thresholdKg.toFixed(2)}kg from ${thresholdSource}. ` +
    `weeksToThreshold=${weeksToThreshold.toFixed(1)} vs flag=${SLEEP_SACK_OUTGROWING.flagWithinWeeks}wk ` +
    `imminent=${SLEEP_SACK_OUTGROWING.highConfidenceWithinWeeks}wk. KB: ${SLEEP_SACK_KB.source}`;

  if (reachedNow) {
    return [
      {
        kidId: kid.id,
        headline: `${kid.name} is ready to size up their sleep sack`,
        body:
          `${kid.name}'s last weight was ${latest.value} kg on ${latest.measuredOn}; projecting forward ` +
          `(${projMethod}) they're around ${projectedKg.toFixed(1)} kg today and at/over the ${thresholdKg.toFixed(1)} kg ` +
          `size-up point.${staleNote}`,
        suggestedAction:
          "Order the next sleep-sack size — check the new size's weight range on the product label before buying.",
        triggerSource: "lookahead",
        triggerDetail: "outgrowing:sleep_sack",
        citedRecord: { kidSpineId, path: "gear.sleep_sack" },
        reasoning,
        confidence: "high",
        rawScore,
      },
    ];
  }

  return [
    {
      kidId: kid.id,
      headline: `${kid.name} will outgrow their ${sizeLabel} soon`,
      body:
        `${kid.name}'s last weight was ${latest.value} kg on ${latest.measuredOn}. Projecting forward ` +
        `(${projMethod}), they're around ${projectedKg.toFixed(1)} kg at ${formatAge(kid.dob, asOf)} and tracking to ` +
        `hit the ${thresholdKg.toFixed(1)} kg size-up point in roughly ${weeksRounded} week${weeksRounded === 1 ? "" : "s"}.${staleNote}`,
      suggestedAction:
        "Order the next size in the next couple of weeks — confirm the new size's weight range on the product label.",
      triggerSource: "lookahead",
      triggerDetail: "outgrowing:sleep_sack",
      citedRecord: { kidSpineId, path: "gear.sleep_sack" },
      reasoning,
      confidence,
      rawScore,
    },
  ];
}

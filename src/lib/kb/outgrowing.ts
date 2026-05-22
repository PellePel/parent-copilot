/**
 * Outgrowing knowledge base.
 *
 * Pure data + small lookup helpers. The engine reads from here; nothing here
 * reaches into the DB. Every fact carries a `source` so brief items can cite
 * provenance.
 *
 * Numbers calibrated to the PRD appendix and AAP/clothing-industry norms.
 * When in doubt, prefer wider replacement windows than tighter — false
 * positives kill trust (R2) and missing a "your kid might be outgrowing X"
 * by a week is cheaper than firing it incorrectly.
 */

// =============================================================================
// Foot growth & shoe replacement
// =============================================================================

export type ShoeReplacementBand = {
  /** inclusive lower bound, in months */
  ageMonthsMin: number;
  /** exclusive upper bound, in months */
  ageMonthsMax: number;
  /** typical replacement window in months — center of the band */
  replaceEveryMonths: number;
  /** lower edge of the replacement window (start flagging here) */
  flagAtMonths: number;
  /** upper edge — definitely overdue past this */
  overdueAtMonths: number;
  source: string;
};

export const SHOE_REPLACEMENT_BANDS: ShoeReplacementBand[] = [
  {
    ageMonthsMin: 12,
    ageMonthsMax: 30,
    replaceEveryMonths: 2.5,
    flagAtMonths: 2,
    overdueAtMonths: 3,
    source: "PRD appendix; Wenger et al. 1983 (~1.5mm/month foot growth)",
  },
  {
    ageMonthsMin: 30,
    ageMonthsMax: 48,
    replaceEveryMonths: 4,
    flagAtMonths: 3.5,
    overdueAtMonths: 5,
    source: "PRD appendix; ~1mm/month foot growth, 30mo–4y",
  },
  {
    ageMonthsMin: 48,
    ageMonthsMax: 72,
    replaceEveryMonths: 6,
    flagAtMonths: 5,
    overdueAtMonths: 7,
    source: "PRD appendix; ~1mm/month foot growth, 4–6y",
  },
];

export function shoeBandForAge(ageMonths: number): ShoeReplacementBand | null {
  return (
    SHOE_REPLACEMENT_BANDS.find(
      (b) => ageMonths >= b.ageMonthsMin && ageMonths < b.ageMonthsMax,
    ) ?? null
  );
}

// =============================================================================
// Clothing sizing
// =============================================================================
// Sizes are stored as MONTHS in the measurements table:
//   12 = 12-month, 24 = "2T", 36 = "3T", 48 = "4T", 60 = "5T".
// Toddler "T" sizes overlap with infant month sizes around 24m — we don't
// disambiguate; consumers should treat them as equivalent integers.
//
// Typical fit window: a garment sized N months fits ages roughly (N-3) to N.
// Past N+OUTGROWING_THRESHOLD months of age, the kid has very likely outgrown
// the size.

export const CLOTHING_OUTGROWING = {
  /**
   * Number of months past the upper edge of a size before we flag it as
   * "likely outgrown." 3 months is the smallest gap that's almost always
   * a true positive across brands.
   */
  flagAtOverageMonths: 3,
  /** Definitely overdue past this overage. */
  overdueAtOverageMonths: 6,
  source:
    "Industry sizing convention: a 'N-month' garment fits ages ~N-3 to N. Past N+3 months of age, fit is unreliable.",
};

/**
 * Returns a typical clothing size (in months) for a kid of the given age.
 * Used to set rough expectations when no measurement is logged yet.
 */
export function expectedClothingSizeMonths(ageMonths: number): number {
  if (ageMonths < 3) return 3;
  if (ageMonths < 6) return 6;
  if (ageMonths < 9) return 9;
  if (ageMonths < 12) return 12;
  if (ageMonths < 18) return 18;
  if (ageMonths < 24) return 24;
  if (ageMonths < 36) return 36; // 3T
  if (ageMonths < 48) return 48; // 4T
  return 60; // 5T+
}

// =============================================================================
// Weight-gain rates (carseat outgrowing prediction)
// =============================================================================
// Used to project when a kid will hit their carseat's weight limit. Individual
// growth varies widely (±50%); these are planning estimates, not forecasts.
// Engine outputs explicitly defer to the seat's manual.

export type WeightGainBand = {
  ageMonthsMin: number;
  ageMonthsMax: number;
  kgPerWeek: number;
};

// Rates calibrated to WHO 50th-percentile boys' growth chart (delta in
// median weight between band endpoints, expressed as kg/week). These are
// medians, not maxes — a kid tracking on the 90th percentile gains faster,
// and a kid on the 10th gains slower. Engine output should acknowledge this.
export const WEIGHT_GAIN_BANDS: WeightGainBand[] = [
  { ageMonthsMin: 0, ageMonthsMax: 6, kgPerWeek: 0.17 },
  { ageMonthsMin: 6, ageMonthsMax: 12, kgPerWeek: 0.07 },
  { ageMonthsMin: 12, ageMonthsMax: 24, kgPerWeek: 0.05 },
  { ageMonthsMin: 24, ageMonthsMax: 60, kgPerWeek: 0.04 },
];

export const WEIGHT_GAIN_KB = {
  source:
    "WHO 50th-percentile boys growth chart medians. Individual kids vary ±2 percentile bands either way; treat as a planning estimate, not a forecast.",
};

export function weightGainBandForAge(ageMonths: number): WeightGainBand | null {
  return (
    WEIGHT_GAIN_BANDS.find(
      (b) => ageMonths >= b.ageMonthsMin && ageMonths < b.ageMonthsMax,
    ) ?? null
  );
}

const WEEKS_PER_MONTH = 4.345;

/**
 * Walk forward through the age bands, applying the correct gain rate within
 * each. Single-band projection systematically underestimates infant growth
 * because rates drop sharply with age; per-band projection is more honest.
 */
export function projectWeightForward(
  startKg: number,
  startAgeMonths: number,
  weeksElapsed: number,
): number {
  if (weeksElapsed <= 0) return startKg;
  let kg = startKg;
  let age = startAgeMonths;
  let remaining = weeksElapsed;
  while (remaining > 0) {
    const band = weightGainBandForAge(age);
    if (!band) {
      // Past the last modeled band — taper using the slowest band's rate.
      const fallback = WEIGHT_GAIN_BANDS[WEIGHT_GAIN_BANDS.length - 1]!;
      kg += fallback.kgPerWeek * remaining;
      break;
    }
    const weeksUntilBandEnd = (band.ageMonthsMax - age) * WEEKS_PER_MONTH;
    const weeksInThisBand = Math.min(remaining, weeksUntilBandEnd);
    kg += band.kgPerWeek * weeksInThisBand;
    age += weeksInThisBand / WEEKS_PER_MONTH;
    remaining -= weeksInThisBand;
  }
  return kg;
}

/**
 * Weeks from (startKg, startAgeMonths) until projected weight reaches targetKg.
 * Returns 0 if already there or above; null if target isn't reachable within
 * the modeled age range (5-year horizon).
 */
export function weeksUntilTargetWeight(
  startKg: number,
  startAgeMonths: number,
  targetKg: number,
): number | null {
  if (targetKg <= startKg) return 0;
  let kg = startKg;
  let age = startAgeMonths;
  let totalWeeks = 0;
  const MAX_HORIZON_WEEKS = 52 * 5;
  while (totalWeeks < MAX_HORIZON_WEEKS) {
    const band = weightGainBandForAge(age);
    if (!band) return null;
    const weeksUntilBandEnd = (band.ageMonthsMax - age) * WEEKS_PER_MONTH;
    const gap = targetKg - kg;
    const weeksAtThisRate = gap / band.kgPerWeek;
    if (weeksAtThisRate <= weeksUntilBandEnd) {
      return totalWeeks + weeksAtThisRate;
    }
    kg += band.kgPerWeek * weeksUntilBandEnd;
    age = band.ageMonthsMax;
    totalWeeks += weeksUntilBandEnd;
  }
  return null;
}

// =============================================================================
// Carseat outgrowing thresholds
// =============================================================================

export const CARSEAT_OUTGROWING = {
  /** How far ahead (in weeks) we look for the limit before flagging. */
  flagWithinWeeks: 12,
  /** Under this many weeks until the limit, escalate to high confidence. */
  highConfidenceWithinWeeks: 4,
  source:
    "Conservative window — seat manufacturers recommend transitioning when EITHER weight or height limit is approached. Engine only models weight; the suggested action always defers to the seat's manual.",
};

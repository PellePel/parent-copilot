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

/**
 * Gear knowledge base — weight-threshold gear transitions.
 *
 * Pure data + small lookup helpers; nothing here touches the DB. Every fact
 * carries a `source` so brief items can cite provenance.
 *
 * Sleep-sack (wearable blanket) sizing is by weight, and the "size up" signal
 * is the child approaching the upper weight of their current size. Brand
 * ranges vary, so the engine's suggested action always defers to the product
 * label; these defaults exist so we can forecast the transition before a
 * parent notices. A per-kid override (a noted threshold like "18 lb") lives in
 * the spine and takes precedence — see the engine.
 */

/** Pounds → kilograms (avdp). Thresholds are often stated in lb; the
 * measurements table stores weight_kg, so convert at the boundary. */
export const LB_PER_KG = 2.2046226218;
export function lbToKg(lb: number): number {
  return lb / LB_PER_KG;
}
export function kgToLb(kg: number): number {
  return kg * LB_PER_KG;
}

export type SleepSackBand = {
  /** human label for the current size */
  size: string;
  /** size up as the child approaches this upper weight (kg) */
  maxWeightKg: number;
  source: string;
};

// Approximate upper weights for common wearable-blanket sizes, in kg
// (≈18 / 28 / 36 lb). Brands differ; these are planning defaults, not a spec.
export const SLEEP_SACK_BANDS: SleepSackBand[] = [
  { size: "Small", maxWeightKg: lbToKg(18), source: "Common wearable-blanket sizing (HALO/Kyte/Woolino), Small ≈ up to 18 lb" },
  { size: "Medium", maxWeightKg: lbToKg(28), source: "Common wearable-blanket sizing (HALO/Kyte/Woolino), Medium ≈ up to 28 lb" },
  { size: "Large", maxWeightKg: lbToKg(36), source: "Common wearable-blanket sizing (HALO/Kyte/Woolino), Large ≈ up to 36 lb" },
];

export const SLEEP_SACK_KB = {
  source:
    "Wearable-blanket sizing varies by brand; size up as the child nears the upper weight of the current size. The suggested action always defers to the product label.",
};

/**
 * The next weight (kg) at which the child should size up — the smallest band
 * upper-weight strictly greater than the current weight. Null if the child is
 * already past the largest modeled size.
 */
export function nextSleepSackThresholdKg(currentKg: number): SleepSackBand | null {
  return SLEEP_SACK_BANDS.find((b) => b.maxWeightKg > currentKg) ?? null;
}

export const SLEEP_SACK_OUTGROWING = {
  /** How far ahead (weeks) we look for the size-up before flagging. */
  flagWithinWeeks: 8,
  /** Under this many weeks until the threshold, escalate to high confidence. */
  highConfidenceWithinWeeks: 3,
  source:
    "Shorter horizon than carseat — a sleep sack is quick and cheap to replace, so we flag closer to the crossing.",
};

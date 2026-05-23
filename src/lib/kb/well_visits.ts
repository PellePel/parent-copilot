/**
 * AAP Bright Futures well-visit schedule.
 *
 * Shared knowledge base used by both the Lookahead absence-detection engine
 * (Phase 2c — "this visit is age-due but not on the calendar") and, later,
 * the Schedule trigger (Phase 3 — "this visit is on the calendar next week,
 * here's what to expect").
 *
 * Source: AAP Bright Futures / Periodicity Schedule.
 */

export type WellVisitMilestone = {
  /** Stable slug used in triggerDetail. */
  id: string;
  /** Target age in months. (3-5 day visit is treated as 0; we don't model it.) */
  ageMonths: number;
  /** Human label for prose (e.g. "6-month well-visit"). */
  label: string;
  /** Vaccines AAP/CDC schedules typically expect at this visit. Informational
   *  for now (will be used by Phase 3 Schedule trigger to set expectations). */
  expectedVaccines?: string[];
  /** Half-width of the "on schedule" window, in weeks. A visit anywhere in
   *  this window counts as "scheduled". */
  windowWeeks: number;
};

// windowWeeks is the ± tolerance for considering a visit "handled" by a
// logged well_visit event near the target date. Pediatric scheduling has
// real-world slack; tighter windows would false-positively flag visits the
// user actually had a couple weeks off-schedule.
export const WELL_VISIT_SCHEDULE: WellVisitMilestone[] = [
  { id: "1mo", ageMonths: 1, label: "1-month well-visit", windowWeeks: 3 },
  { id: "2mo", ageMonths: 2, label: "2-month well-visit", windowWeeks: 3,
    expectedVaccines: ["DTaP", "IPV", "Hib", "PCV13", "RV", "HepB"] },
  { id: "4mo", ageMonths: 4, label: "4-month well-visit", windowWeeks: 4,
    expectedVaccines: ["DTaP", "IPV", "Hib", "PCV13", "RV"] },
  { id: "6mo", ageMonths: 6, label: "6-month well-visit", windowWeeks: 4,
    expectedVaccines: ["DTaP", "Hib", "PCV13", "HepB", "Influenza (seasonal)"] },
  { id: "9mo", ageMonths: 9, label: "9-month well-visit", windowWeeks: 4 },
  { id: "12mo", ageMonths: 12, label: "12-month well-visit", windowWeeks: 5,
    expectedVaccines: ["MMR", "Varicella", "HepA", "PCV13", "Hib"] },
  { id: "15mo", ageMonths: 15, label: "15-month well-visit", windowWeeks: 5,
    expectedVaccines: ["DTaP"] },
  { id: "18mo", ageMonths: 18, label: "18-month well-visit", windowWeeks: 5,
    expectedVaccines: ["HepA (booster)"] },
  { id: "24mo", ageMonths: 24, label: "2-year well-visit", windowWeeks: 6 },
  { id: "30mo", ageMonths: 30, label: "2.5-year well-visit", windowWeeks: 6 },
  { id: "3y", ageMonths: 36, label: "3-year well-visit", windowWeeks: 8 },
  { id: "4y", ageMonths: 48, label: "4-year well-visit", windowWeeks: 8,
    expectedVaccines: ["DTaP", "IPV", "MMR", "Varicella"] },
  { id: "5y", ageMonths: 60, label: "5-year well-visit", windowWeeks: 8 },
];

export const WELL_VISIT_KB = {
  source: "American Academy of Pediatrics — Bright Futures / Recommendations for Preventive Pediatric Health Care",
};

/**
 * Returns the next well-visit a kid is approaching or just past (within ±N
 * weeks of `ageMonthsNow`). If the kid is between two visits, returns the
 * nearer one.
 */
export function nearestWellVisit(
  ageMonthsNow: number,
  withinWeeks = 12,
): WellVisitMilestone | null {
  const WEEKS_PER_MONTH = 4.345;
  let best: { v: WellVisitMilestone; weeksAway: number } | null = null;
  for (const v of WELL_VISIT_SCHEDULE) {
    const weeksAway = Math.abs(v.ageMonths - ageMonthsNow) * WEEKS_PER_MONTH;
    if (weeksAway > withinWeeks) continue;
    if (!best || weeksAway < best.weeksAway) best = { v, weeksAway };
  }
  return best?.v ?? null;
}

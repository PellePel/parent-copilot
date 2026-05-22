/**
 * Age and date helpers. All dates are ISO YYYY-MM-DD strings.
 * Calculations happen in UTC to avoid local-timezone DST surprises.
 */

const MS_PER_DAY = 86_400_000;

function toUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** Whole days between two ISO dates (later - earlier). Can be negative. */
export function daysBetween(earlier: string, later: string): number {
  const e = toUtcDate(earlier).getTime();
  const l = toUtcDate(later).getTime();
  return Math.round((l - e) / MS_PER_DAY);
}

/**
 * Age in whole months as of `asOf` (defaults to today). Uses the calendar-
 * aware "anniversary" definition: 2026-03-22 minus 2025-12-07 is 3 months.
 */
export function ageInMonths(dob: string, asOf?: string): number {
  const d = toUtcDate(dob);
  const t = asOf ? toUtcDate(asOf) : toUtcDate(todayIso());
  let months = (t.getUTCFullYear() - d.getUTCFullYear()) * 12;
  months += t.getUTCMonth() - d.getUTCMonth();
  if (t.getUTCDate() < d.getUTCDate()) months -= 1;
  return months;
}

/** Age in whole days as of `asOf` (defaults to today). */
export function ageInDays(dob: string, asOf?: string): number {
  return daysBetween(dob, asOf ?? todayIso());
}

/** ISO YYYY-MM-DD for today (UTC). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Human-readable age string used in brief item bodies.
 * Examples: "5 months", "2 years, 4 months", "11 days" (under 1 month).
 */
export function formatAge(dob: string, asOf?: string): string {
  const months = ageInMonths(dob, asOf);
  if (months < 1) {
    const days = ageInDays(dob, asOf);
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${months} month${months === 1 ? "" : "s"}`;
  if (rem === 0) return `${years} year${years === 1 ? "" : "s"}`;
  return `${years} year${years === 1 ? "" : "s"}, ${rem} month${rem === 1 ? "" : "s"}`;
}

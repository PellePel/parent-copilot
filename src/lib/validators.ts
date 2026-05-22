import { z } from "zod";

/**
 * ISO calendar date (YYYY-MM-DD), validated both for shape and for real-ness.
 * 2026-02-30 and 2026-13-99 both fail (the regex passes the first, the refine
 * catches both).
 */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "not a real calendar date");

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

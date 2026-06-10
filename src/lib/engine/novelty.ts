/**
 * Novelty scoring — the week-over-week "what's newly relevant" signal (R4).
 *
 * Delight lives in the delta: a standing fact ("Clem is in a language window")
 * lands once, then becomes wallpaper if it re-headlines unchanged every week.
 * This pass scores a candidate by how *fresh* its (kid, triggerDetail) is,
 * measured against the recent brief history. The web hero-selection (U3) sorts
 * by this score so repeated items sink and newly-true ones rise.
 *
 * Deliberately kept separate from the assembler's `rawScore` / `priority`
 * model — this does not mutate engine ranking; it is an additional axis the
 * read model consumes.
 */

import { recentFireCount } from "./suppression.js";
import type { Candidate } from "./types.js";

/** How many weeks back the novelty window looks. */
export const NOVELTY_WEEKS_BACK = 6;
/** Starting score for a never-recently-seen item. */
const NOVELTY_BASE = 100;
/** Score lost per prior weekly appearance inside the window. */
const PENALTY_PER_APPEARANCE = 25;

/**
 * 0–100, higher = more novel. A candidate not seen in the window scores
 * `NOVELTY_BASE`; each prior weekly appearance subtracts `PENALTY_PER_APPEARANCE`,
 * flooring at 0. Family-level candidates (`kidId === null`) are handled.
 */
export function noveltyScore(c: Candidate, asOf: string): number {
  const count = recentFireCount(c.kidId, c.triggerDetail, NOVELTY_WEEKS_BACK, asOf);
  return Math.max(0, NOVELTY_BASE - count * PENALTY_PER_APPEARANCE);
}

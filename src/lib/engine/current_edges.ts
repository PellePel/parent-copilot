/**
 * Current-edges matcher.
 *
 * Per the v2.1 spec, each kid's `developmental.current_edges` lists what
 * they're actively working on. Signals related to these should be priority-
 * boosted in the brief and used by the polish prompt for voice cues.
 *
 * Rather than push edge-awareness into every engine, this module does the
 * matching centrally on already-produced Candidates. The CLI calls
 * `annotateWithEdges` after collecting candidates and before passing them to
 * the assembler. The assembler then applies a score boost (see EDGE_BOOST).
 *
 * Maintenance: when a new engine emits a triggerDetail that should map to
 * specific edge concepts, add an entry to TRIGGER_KEYWORDS below.
 */

import { type Kid as ContextKid, getKidCurrentEdges } from "../context.js";
import type { Candidate } from "./types.js";

/** Score boost applied when a candidate is related to a current edge. */
export const EDGE_BOOST = 10;

/**
 * Per-triggerDetail-prefix keyword maps. If the candidate's triggerDetail
 * starts with the key, we check each of the kid's current_edges for any of
 * the listed keywords (lowercased substring match). First match wins.
 */
const TRIGGER_KEYWORDS: Record<string, string[]> = {
  "allergen:": ["solid food", "allergen", "feeding", "weaning"],
  "developmental:solids_introduction_window": [
    "solid food",
    "feeding",
    "weaning",
    "solids",
  ],
  "developmental:sitting_unassisted_window": ["sitting"],
  "developmental:object_permanence_window": ["object permanence"],
  "developmental:crawling_window": ["crawling"],
  "developmental:first_steps_window": ["walking", "first steps", "cruising"],
  "developmental:first_words_window": ["language", "first words"],
  "developmental:two_word_phrases_window": ["language", "two-word", "phrases"],
  "developmental:simple_sentences_window": ["language", "sentences"],
  "developmental:potty_training_typical_window": ["potty", "toilet"],
  "vaccine_prep": ["vaccine", "immunization"],
  "outgrowing:carseat": ["carseat", "car seat"],
  "outgrowing:shoes": ["shoes"],
  "outgrowing:clothing": ["clothing", "outfit"],
  "absence:well_visit": ["pediatrician", "well visit", "checkup"],
};

/**
 * Find the first current_edge the candidate relates to, if any. Returns the
 * matched edge string (verbatim from the kid's context), or undefined.
 */
export function findRelatedEdge(
  candidate: Candidate,
  edges: string[],
): string | undefined {
  if (edges.length === 0) return undefined;
  const edgesLower = edges.map((e) => ({ raw: e, lower: e.toLowerCase() }));
  for (const [prefix, keywords] of Object.entries(TRIGGER_KEYWORDS)) {
    if (!candidate.triggerDetail.startsWith(prefix)) continue;
    for (const k of keywords) {
      const hit = edgesLower.find((e) => e.lower.includes(k.toLowerCase()));
      if (hit) return hit.raw;
    }
  }
  // Fallback: keyword-free check — does any edge mention a substring that
  // appears in the candidate's headline? Cheap last-resort match for cases
  // we forgot to add to TRIGGER_KEYWORDS.
  const headlineLower = candidate.headline.toLowerCase();
  for (const e of edgesLower) {
    // Only consider edges with reasonably specific words (>4 chars to skip
    // generic words like "the").
    const tokens = e.lower.split(/\W+/).filter((t) => t.length > 4);
    for (const t of tokens) {
      if (headlineLower.includes(t)) return e.raw;
    }
  }
  return undefined;
}

/**
 * Annotate a list of candidates with `relatedToCurrentEdge` in place,
 * looking up each kid's edges from the family context. No-op for candidates
 * with no matching context kid.
 */
export function annotateWithEdges(
  candidates: Candidate[],
  kidContextLookup: (kidId: number | null) => ContextKid | undefined,
): void {
  for (const c of candidates) {
    if (c.kidId === null) continue;
    const contextKid = kidContextLookup(c.kidId);
    if (!contextKid) continue;
    const edges = getKidCurrentEdges(contextKid);
    const matched = findRelatedEdge(c, edges);
    if (matched) c.relatedToCurrentEdge = matched;
  }
}

/** For tests / docs — exposes the pattern table. */
export function _triggerKeywords(): typeof TRIGGER_KEYWORDS {
  return TRIGGER_KEYWORDS;
}

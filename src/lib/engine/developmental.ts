/**
 * Developmental-windows engine — the second sub-module of Lookahead.
 *
 * For each kid, fires candidates for any developmental window whose active
 * range (onsetMin to onsetMax + durationMonths) contains the kid's current
 * age, with two filtering layers (in order):
 *
 *   1. Context suppression — the BELT. If the kid's family_context.json has
 *      a matching milestone marked cleared/ongoing/emerging, or if
 *      things_we_already_know names this window directly or via a category
 *      rule, we never emit the candidate. See context_suppression.ts.
 *   2. Per-kid cap — at most 2 developmental items per kid per brief, so
 *      dense age bands don't flood the brief.
 *
 * Time-based suppression (firedInLast) is intentionally NOT used here per
 * the v2.1 spec — context suppression is the canonical mechanism. If a
 * window keeps firing and the user is annoyed, the cure is to add an entry
 * to things_we_already_know (or update the milestone status), not a
 * back-off timer.
 *
 * Scoring blends confidence with freshness (how recently the kid entered
 * the window) so newer windows beat stale ones at the same confidence.
 */

import { ageInMonths, formatAge, todayIso } from "../age.js";
import { type Kid as DbKid } from "../db/schema.js";
import {
  activeDevelopmentalWindows,
  type DevelopmentalWindow,
} from "../kb/developmental.js";
import {
  type ContextMilestone,
  type Kid as ContextKid,
  getKidMilestones,
  getKidSuppressions,
  spineIdFromName,
} from "../context.js";
import { isSuppressedByContext } from "./context_suppression.js";
import type { Candidate } from "./types.js";

const MAX_DEVELOPMENTAL_PER_KID = 2;

const CONFIDENCE_BASE: Record<string, number> = {
  high: 60,
  medium: 45,
  low: 30,
};
const FRESHNESS_BONUS_MAX = 10;

function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

/**
 * Freshness in [0, 1]: 1 at the moment of onset, 0 at the end of the active
 * range. Higher freshness = more useful "heads up."
 */
function freshness(window: DevelopmentalWindow, ageMonths: number): number {
  const start = window.onsetAgeMonthsMin;
  const end = window.onsetAgeMonthsMax + window.durationMonths;
  if (end <= start) return 1;
  const elapsed = ageMonths - start;
  const total = end - start;
  return Math.max(0, Math.min(1, 1 - elapsed / total));
}

function buildReasoning(window: DevelopmentalWindow, ageMonths: number): string {
  const f = freshness(window, ageMonths);
  return (
    `Kid age=${ageMonths.toFixed(1)}mo is inside the active range for ` +
    `'${window.id}' (onset ${window.onsetAgeMonthsMin}-${window.onsetAgeMonthsMax}mo, ` +
    `duration ${window.durationMonths}mo). Confidence=${window.confidence} ` +
    `(KB default), freshness=${f.toFixed(2)}. Not suppressed by context. ` +
    `KB source: ${window.source}.`
  );
}

export type DevelopmentalOptions = {
  maxPerKid?: number;
  /**
   * Context kid + suppression data, if available. When provided, the engine
   * applies belt-style context suppression. When omitted, all active windows
   * fire (subject to per-kid cap). The CLI should pass context whenever it's
   * loaded successfully.
   */
  contextKid?: ContextKid;
};

export function developmentalCandidatesFor(
  kid: DbKid,
  asOf: string = todayIso(),
  options: DevelopmentalOptions = {},
): Candidate[] {
  const cap = options.maxPerKid ?? MAX_DEVELOPMENTAL_PER_KID;
  const ageMonths = ageInMonths(kid.dob, asOf);
  const active = activeDevelopmentalWindows(ageMonths);
  if (active.length === 0) return [];

  // Context-driven suppression inputs (empty defaults if no context loaded).
  const contextMilestones: ContextMilestone[] = options.contextKid
    ? getKidMilestones(options.contextKid)
    : [];
  const thingsWeAlreadyKnow: string[] = options.contextKid
    ? getKidSuppressions(options.contextKid)
    : [];

  const vars = {
    name: kid.name,
    age_str: formatAge(kid.dob, asOf),
  };

  // Prefer the context kid's spine id (authoritative), then the DB row's
  // spine_id, then a name-derived fallback for rows that predate the column.
  const kidSpineId = options.contextKid?.id ?? kid.spineId ?? spineIdFromName(kid.name);

  const candidates: Candidate[] = [];
  for (const w of active) {
    const suppression = isSuppressedByContext(
      w,
      ageMonths,
      contextMilestones,
      thingsWeAlreadyKnow,
    );
    if (suppression.suppressed) continue;

    const base = CONFIDENCE_BASE[w.confidence] ?? 40;
    const bonus = freshness(w, ageMonths) * FRESHNESS_BONUS_MAX;
    const rawScore = Math.round(base + bonus);

    candidates.push({
      kidId: kid.id,
      headline: applyTemplate(w.headlineTemplate, vars),
      body: applyTemplate(w.bodyTemplate, vars),
      suggestedAction: w.suggestedActionTemplate
        ? applyTemplate(w.suggestedActionTemplate, vars)
        : undefined,
      triggerSource: "lookahead",
      triggerDetail: `developmental:${w.id}`,
      citedRecord: { kidSpineId, path: `developmental.milestones[${w.id}]` },
      factTarget: { kind: "milestone", id: w.id },
      reasoning: buildReasoning(w, ageMonths),
      confidence: w.confidence,
      rawScore,
    });
  }

  // Cap per kid: highest-scoring N.
  candidates.sort((a, b) => b.rawScore - a.rawScore);
  return candidates.slice(0, cap);
}

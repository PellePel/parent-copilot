/**
 * Developmental-windows engine — the second sub-module of Lookahead.
 *
 * For each kid, fires candidates for any developmental window whose active
 * range (onsetMin to onsetMax + durationMonths) contains the kid's current
 * age. Two guards against weekly spam:
 *
 *   1. Per-window suppression: don't re-fire a (kidId, triggerDetail) that
 *      appeared in any brief within the last 4 weeks. Reads from past
 *      brief_items, no new tables.
 *   2. Per-kid cap: at most 2 developmental items per kid per brief. Kids in
 *      the densest age bands (e.g. 5-6mo: 5+ active windows) have a lot to
 *      say; we keep the brief readable by surfacing the highest-scoring two.
 *
 * Scoring blends confidence with freshness (how recently the kid entered the
 * window) so newer windows beat stale ones at the same confidence level.
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { ageInMonths, formatAge, todayIso } from "../age.js";
import { db } from "../db/index.js";
import { briefItems, briefs, type Kid } from "../db/schema.js";
import {
  activeDevelopmentalWindows,
  type DevelopmentalWindow,
} from "../kb/developmental.js";
import type { Candidate } from "./types.js";

const SUPPRESSION_WINDOW_WEEKS = 4;
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
 * Has this (kidId, triggerDetail) appeared in any brief whose weekOf is on
 * or after `asOf - weeksBack`?
 */
function firedInLast(
  kidId: number,
  triggerDetail: string,
  weeksBack: number,
  asOf: string,
): boolean {
  const asOfMs = new Date(`${asOf}T00:00:00Z`).getTime();
  const cutoff = new Date(asOfMs - weeksBack * 7 * 86_400_000).toISOString().slice(0, 10);
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(briefItems)
    .innerJoin(briefs, eq(briefItems.briefId, briefs.id))
    .where(
      and(
        eq(briefItems.kidId, kidId),
        eq(briefItems.triggerDetail, triggerDetail),
        gte(briefs.weekOf, cutoff),
      ),
    )
    .get();
  return (row?.n ?? 0) > 0;
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

function buildReasoning(
  window: DevelopmentalWindow,
  ageMonths: number,
  suppressionWeeks: number,
): string {
  const f = freshness(window, ageMonths);
  return (
    `Kid age=${ageMonths.toFixed(1)}mo is inside the active range for ` +
    `'${window.id}' (onset ${window.onsetAgeMonthsMin}-${window.onsetAgeMonthsMax}mo, ` +
    `duration ${window.durationMonths}mo). Confidence=${window.confidence} ` +
    `(KB default), freshness=${f.toFixed(2)}. Not fired in any brief in the ` +
    `last ${suppressionWeeks} weeks. KB source: ${window.source}.`
  );
}

export function developmentalCandidatesFor(
  kid: Kid,
  asOf: string = todayIso(),
  options: { suppressionWindowWeeks?: number; maxPerKid?: number } = {},
): Candidate[] {
  const suppressionWeeks = options.suppressionWindowWeeks ?? SUPPRESSION_WINDOW_WEEKS;
  const cap = options.maxPerKid ?? MAX_DEVELOPMENTAL_PER_KID;

  const ageMonths = ageInMonths(kid.dob, asOf);
  const active = activeDevelopmentalWindows(ageMonths);
  if (active.length === 0) return [];

  const vars = {
    name: kid.name,
    age_str: formatAge(kid.dob, asOf),
  };

  const candidates: Candidate[] = [];
  for (const w of active) {
    const triggerDetail = `developmental:${w.id}`;
    if (firedInLast(kid.id, triggerDetail, suppressionWeeks, asOf)) continue;

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
      triggerDetail,
      reasoning: buildReasoning(w, ageMonths, suppressionWeeks),
      confidence: w.confidence,
      rawScore,
    });
  }

  // Cap per kid: highest-scoring N.
  candidates.sort((a, b) => b.rawScore - a.rawScore);
  return candidates.slice(0, cap);
}

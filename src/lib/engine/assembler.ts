/**
 * Brief assembler.
 *
 * Phase 2a version: takes raw candidates from all engines, dedupes by
 * (kidId, triggerDetail), ranks by rawScore, caps at MAX_ITEMS, assigns
 * priority, and persists a brief + brief_items in one transaction.
 *
 * No Claude prose-rewrite yet — items go in verbatim. That comes in Phase 2d.
 */

import { db } from "../db/index.js";
import {
  briefs,
  briefItems,
  type Brief,
  type BriefItem,
} from "../db/schema.js";
import { EDGE_BOOST } from "./current_edges.js";
import type { Candidate } from "./types.js";

/** PRD: 3–7 items per brief. */
const MAX_ITEMS = 7;
const MIN_ITEMS = 3;

export type AssembledBrief = {
  brief: Brief;
  items: BriefItem[];
  /** Candidates that didn't make the final cut (dedup loser or below MAX_ITEMS). */
  dropped: Candidate[];
};

/**
 * Sunday of the week containing the given date (UTC). Defaults to today's week.
 * V1 briefs go out Sunday morning, so weekOf = the Sunday they cover.
 */
function sundayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/** Stable dedup key: same (kidId, triggerDetail) → one item, keep highest score. */
function dedupKey(c: Candidate): string {
  return `${c.kidId ?? "family"}|${c.triggerDetail}`;
}

/**
 * Dedup by (kidId, triggerDetail) keeping the highest rawScore, then rank by
 * (rawScore desc, then confidence desc), then cap at MAX_ITEMS.
 * Pure function — no DB access.
 */
export function selectCandidates(candidates: Candidate[]): {
  kept: Candidate[];
  dropped: Candidate[];
} {
  const winners = new Map<string, Candidate>();
  const dropped: Candidate[] = [];
  for (const c of candidates) {
    const key = dedupKey(c);
    const existing = winners.get(key);
    if (!existing) {
      winners.set(key, c);
    } else if (c.rawScore > existing.rawScore) {
      dropped.push(existing);
      winners.set(key, c);
    } else {
      dropped.push(c);
    }
  }
  // Effective score = rawScore + EDGE_BOOST if this candidate is related to a
  // kid's current_edge (v2.1 spec — priority boost). Boost is applied for
  // ranking only; the persisted rawScore is left as-is so the engine output
  // remains auditable.
  const confidenceRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const effective = (c: Candidate): number =>
    c.rawScore + (c.relatedToCurrentEdge ? EDGE_BOOST : 0);
  const ranked = [...winners.values()].sort((a, b) => {
    const ea = effective(a);
    const eb = effective(b);
    if (eb !== ea) return eb - ea;
    return confidenceRank[b.confidence]! - confidenceRank[a.confidence]!;
  });
  const kept = ranked.slice(0, MAX_ITEMS);
  for (const c of ranked.slice(MAX_ITEMS)) dropped.push(c);
  return { kept, dropped };
}

/** Persist already-selected candidates as a brief + brief_items in one txn. */
export function persistBrief(
  kept: Candidate[],
  options: {
    weekOfIso?: string;
    recipients: string[];
    dropped?: Candidate[];
  },
): AssembledBrief {
  const weekOf = sundayOf(options.weekOfIso ?? new Date().toISOString().slice(0, 10));
  const result = db.transaction((tx) => {
    const brief = tx
      .insert(briefs)
      .values({ weekOf, recipients: options.recipients })
      .returning()
      .get();
    if (kept.length === 0) {
      return { brief, items: [] as BriefItem[] };
    }
    const items = tx
      .insert(briefItems)
      .values(
        kept.map((c, i) => ({
          briefId: brief.id,
          kidId: c.kidId ?? null,
          headline: c.headline,
          body: c.body,
          suggestedAction: c.suggestedAction,
          triggerSource: c.triggerSource,
          triggerDetail: c.triggerDetail,
          reasoning: c.reasoning,
          confidence: c.confidence,
          priority: i + 1,
          relatedToCurrentEdge: c.relatedToCurrentEdge ?? null,
          citedRecord: c.citedRecord,
          factTarget: c.factTarget ?? null,
        })),
      )
      .returning()
      .all();
    return { brief, items };
  });
  return { ...result, dropped: options.dropped ?? [] };
}

/**
 * Convenience wrapper: select + (optionally polish) + persist. Polish runs
 * AFTER selection so it only spends tokens on the items we'll actually keep.
 */
export async function assembleBrief(
  candidates: Candidate[],
  options: {
    weekOfIso?: string;
    recipients: string[];
    polish?: (kept: Candidate[]) => Promise<Candidate[]>;
  },
): Promise<AssembledBrief> {
  const { kept, dropped } = selectCandidates(candidates);
  const finalKept = options.polish ? await options.polish(kept) : kept;
  return persistBrief(finalKept, {
    weekOfIso: options.weekOfIso,
    recipients: options.recipients,
    dropped,
  });
}

export { MIN_ITEMS, MAX_ITEMS };

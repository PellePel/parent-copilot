/**
 * Structured per-brief log (v2.1 spec).
 *
 * Every brief writes a sibling JSON file (briefs/YYYY-MM-DD.log.json) with
 * enough metadata to answer the spec's debugging questions:
 *
 *   - "Why didn't last week's brief mention X?" → check candidate_signals
 *     and `selected: false`.
 *   - "Has the model been quietly leaking suppressed items?" → diff
 *     brief_items_published against context's things_we_already_know.
 *   - "Is brief quality degrading over time?" → compare logs across weeks.
 *   - "What's the average signal-to-brief conversion rate?" → ratio of
 *     selected to total in candidate_signals.
 *
 * Bumping `PROMPT_VERSION` is the convention for "we changed the polish or
 * cross_products prompt materially" — does NOT need to be bumped for KB or
 * rule changes. The log captures both so trends are still attributable.
 */

import { writeFileSync } from "node:fs";
import type { AssembledBrief } from "./assembler.js";
import type { Candidate } from "./types.js";

/** Bump when polish or cross_products system prompts change materially. */
export const PROMPT_VERSION = "v1.2-phase-3d";

export const MODEL = "claude-sonnet-4-5";

export type TokenUsage = { input_tokens: number; output_tokens: number };

export type BriefLog = {
  brief_date: string;
  as_of: string;
  generated_at: string;
  context: {
    loaded: boolean;
    path?: string;
    sha256?: string;
  };
  calendar: {
    status: "ok" | "not_configured" | "error" | "skipped";
    lookahead_days: number;
    events_count: number;
    reason?: string;
  };
  model: string;
  prompt_version: string;
  candidate_signals: Array<{
    trigger_source: string;
    trigger_detail: string;
    kid_id: number | null;
    headline: string;
    raw_score: number;
    confidence: string;
    related_to_current_edge: string | null;
    selected: boolean;
    priority_in_brief: number | null;
  }>;
  brief_items_published: Array<{ priority: number; headline: string }>;
  tokens_used: {
    polish: TokenUsage;
    cross_products: TokenUsage;
  };
  latency_ms: number;
};

export type BriefLogInputs = {
  asOf: string;
  weekOf: string;
  startedAtMs: number;
  contextLoaded: { path: string; sha256: string } | null;
  calendar: BriefLog["calendar"];
  allCandidates: Candidate[];
  assembled: AssembledBrief;
  polishUsage: TokenUsage;
  crossProductsUsage: TokenUsage;
};

export function buildBriefLog(inputs: BriefLogInputs): BriefLog {
  const publishedHeadlines = new Map<string, number>();
  for (const item of inputs.assembled.items) {
    // Same dedup key as the assembler so candidate→item matching works.
    publishedHeadlines.set(`${item.kidId ?? "family"}|${item.triggerDetail}`, item.priority);
  }

  const candidateRows = inputs.allCandidates.map((c) => {
    const key = `${c.kidId ?? "family"}|${c.triggerDetail}`;
    const priority = publishedHeadlines.get(key) ?? null;
    return {
      trigger_source: c.triggerSource,
      trigger_detail: c.triggerDetail,
      kid_id: c.kidId,
      headline: c.headline,
      raw_score: c.rawScore,
      confidence: c.confidence,
      related_to_current_edge: c.relatedToCurrentEdge ?? null,
      selected: priority !== null,
      priority_in_brief: priority,
    };
  });

  return {
    brief_date: inputs.weekOf,
    as_of: inputs.asOf,
    generated_at: new Date().toISOString(),
    context: inputs.contextLoaded
      ? { loaded: true, path: inputs.contextLoaded.path, sha256: inputs.contextLoaded.sha256 }
      : { loaded: false },
    calendar: inputs.calendar,
    model: MODEL,
    prompt_version: PROMPT_VERSION,
    candidate_signals: candidateRows,
    brief_items_published: inputs.assembled.items.map((i) => ({
      priority: i.priority,
      headline: i.headline,
    })),
    tokens_used: {
      polish: inputs.polishUsage,
      cross_products: inputs.crossProductsUsage,
    },
    latency_ms: Date.now() - inputs.startedAtMs,
  };
}

export function writeBriefLog(path: string, log: BriefLog): void {
  writeFileSync(path, JSON.stringify(log, null, 2), "utf8");
}

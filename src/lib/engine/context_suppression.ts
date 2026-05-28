/**
 * Context-driven suppression — the "belt" half of belt-and-suspenders.
 *
 * The spec's primary suppression mechanism is the kid's
 * `things_we_already_know` list, plus the `status` field on each entry in
 * `developmental.milestones[]`. A signal is suppressed if EITHER:
 *
 *   1. The signal's window matches a context milestone with status
 *      cleared / ongoing / emerging (the user already knows about it), OR
 *   2. An entry in `things_we_already_know` matches the window — either
 *      directly (same id, or id minus the `_window` suffix), or via a
 *      category rule (e.g. "language_milestones_through_30mo" suppresses
 *      any language-category window for kids under 30 months).
 *
 * Anything not suppressed here is still subject to semantic suppression in
 * the LLM prompt (the "suspenders" — see polish.ts / cross_products.ts).
 *
 * Maintenance: as Nick adds new things_we_already_know entries that aren't
 * direct window ids, add a rule to SUPPRESSION_CATEGORY_RULES rather than
 * pushing pattern-matching into the prompt.
 */

import type { DevelopmentalWindow } from "../kb/developmental.js";
import type { ContextMilestone } from "../context.js";

// ---------------------------------------------------------------------------
// Milestone id ↔ developmental window id mapping
// ---------------------------------------------------------------------------
// Context milestones use spec-given ids (e.g. simple_sentences_3_4_words).
// Our developmental KB uses suffixed ids (e.g. simple_sentences_window).
// Where they differ enough that fuzzy stripping won't catch it, list the
// pairing here. Add entries as new milestones land in the context.

const MILESTONE_TO_WINDOW_IDS: Record<string, string[]> = {
  simple_sentences_3_4_words: ["simple_sentences_window"],
  tantrums_emotional_dysregulation: ["tantrum_onset"],
  object_permanence: ["object_permanence_window"],
  rolling_back_to_tummy: ["rolling_window"],
  sitting_unassisted: ["sitting_unassisted_window"],
  // Add more as needed — keep keys = context milestone strings,
  // values = our KB window ids.
};

function stripWindowSuffix(id: string): string {
  return id.replace(/_window$/, "");
}

/** True if this developmental window is "covered" by a context milestone. */
function milestoneMatchesWindow(milestone: ContextMilestone, window: DevelopmentalWindow): boolean {
  const explicit = MILESTONE_TO_WINDOW_IDS[milestone.milestone] ?? [];
  if (explicit.includes(window.id)) return true;
  // Fuzzy: strip _window from both sides and compare.
  if (stripWindowSuffix(window.id) === stripWindowSuffix(milestone.milestone)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Category-level suppression rules — match entries in things_we_already_know
// against properties of the developmental window
// ---------------------------------------------------------------------------

type CategoryRule = {
  /** Exact entry from things_we_already_know that triggers this rule. */
  key: string;
  /** Returns true if this window should be suppressed under the rule. */
  matches: (window: DevelopmentalWindow, kidAgeMonths: number) => boolean;
};

const SUPPRESSION_CATEGORY_RULES: CategoryRule[] = [
  {
    key: "language_milestones_through_30mo",
    matches: (w, age) => w.category === "language" && age < 30,
  },
  {
    key: "language_milestones_through_36mo",
    matches: (w, age) => w.category === "language" && age < 36,
  },
  {
    key: "tantrum_onset_and_basic_management",
    matches: (w) => w.id === "tantrum_onset" || w.id.includes("tantrum"),
  },
  {
    key: "sleep_regressions_through_24mo",
    matches: (w, age) => w.category === "sleep" && age < 24,
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type SuppressionResult = {
  suppressed: boolean;
  /** Human-readable reason if suppressed, useful for logging. */
  reason?: string;
};

export function isSuppressedByContext(
  window: DevelopmentalWindow,
  kidAgeMonths: number,
  contextMilestones: ContextMilestone[],
  thingsWeAlreadyKnow: string[],
): SuppressionResult {
  // (1) Cleared / ongoing / emerging milestones from context
  for (const m of contextMilestones) {
    if (m.status !== "cleared" && m.status !== "ongoing" && m.status !== "emerging") continue;
    if (milestoneMatchesWindow(m, window)) {
      return {
        suppressed: true,
        reason: `context milestone '${m.milestone}' status=${m.status}`,
      };
    }
  }

  // (2) things_we_already_know — direct id match, fuzzy match, then category rules
  for (const entry of thingsWeAlreadyKnow) {
    if (entry === window.id) {
      return { suppressed: true, reason: `things_we_already_know exact match '${entry}'` };
    }
    if (entry === stripWindowSuffix(window.id)) {
      return {
        suppressed: true,
        reason: `things_we_already_know fuzzy match '${entry}' ~ '${window.id}'`,
      };
    }
    const rule = SUPPRESSION_CATEGORY_RULES.find((r) => r.key === entry);
    if (rule && rule.matches(window, kidAgeMonths)) {
      return { suppressed: true, reason: `things_we_already_know category rule '${entry}'` };
    }
  }

  return { suppressed: false };
}

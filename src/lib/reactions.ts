/**
 * U7 — Reaction dispatch (deterministic semantics).
 *
 * A tap on a delivered brief item lands here. This module is the deterministic
 * heart of the weekly loop: it reads the cited brief item, resolves the kid's
 * spine id, and applies the per-reaction mutation (suppression upsert, spine
 * fact-update, quarantine, or nothing). No LLM calls — the "wrong" correction
 * is parked for U8 to apply asynchronously.
 *
 * CONTRACT WITH THE FILTER (U6): when we WRITE a suppression we populate
 * `revalidationParams` in the EXACT shape `candidate_filter.ts` reads:
 *   - measurement_band → { type, value, measuredOn }
 *   - until_date       → { date }
 *   - until_milestone_change → { milestoneId }
 *
 * IDEMPOTENCY: the bot may re-deliver a callback (24h backlog, double-tap). We
 * anchor on `telegramCallbackId`: the first call inserts the reaction row and
 * applies the effect; a second call with the same callback id is a no-op.
 */

import { and, desc, eq } from "drizzle-orm";

import { db } from "./db/index.js";
import {
  briefItems,
  delightCandidates,
  factualErrors,
  kids as kidsTable,
  measurements,
  reactions,
  suppressions,
  type CitedRecord,
  type FactTarget,
  type MeasurementType,
  type ReactionKind,
  type RevalidationKind,
} from "./db/schema.js";
import {
  FAMILY_SPINE_ID,
  getKid,
  loadFamilyContext,
  resolveKidSpineId,
} from "./context.js";
import {
  markAllergenIntroduced,
  clearMilestone,
  addThingWeAlreadyKnow,
  quarantineRecord,
} from "./spine_write.js";

// =============================================================================
// Result shape — tells the bot what to show
// =============================================================================

// Every variant carries the reaction row id so the bot (U5) can bind follow-up
// state to it: set promptMessageId on a quarantine, or hand it to applyCorrection.
// For noop_duplicate it's the PRIOR row's id (the one that won the idempotency race).
export type ReactionResult =
  | { kind: "suppressed"; reactionId: number }
  | { kind: "fact_updated"; detail: string; reactionId: number }
  | { kind: "quarantined"; needsCorrection: true; reactionId: number }
  | { kind: "reveal_reasoning"; reasoning: string; reactionId: number }
  | { kind: "noop_duplicate"; reactionId: number };

type Options = {
  /** Spine path override for tests; defaults to data/family_context.json. */
  contextPath?: string;
};

// =============================================================================
// Public API
// =============================================================================

export async function applyReaction(
  briefItemId: number,
  reaction: ReactionKind,
  telegramCallbackId: string,
  opts: Options = {},
): Promise<ReactionResult> {
  // --- 1. Idempotency: a prior reaction with this callback id wins. ---------
  const prior = db
    .select()
    .from(reactions)
    .where(eq(reactions.telegramCallbackId, telegramCallbackId))
    .get();
  if (prior) return { kind: "noop_duplicate", reactionId: prior.id };

  // Insert the reaction row up front — the idempotency anchor.
  const inserted = db
    .insert(reactions)
    .values({ briefItemId, reaction, telegramCallbackId })
    .returning({ id: reactions.id })
    .get();
  const reactionId = inserted.id;

  // --- 2. Read the brief item + resolve the kid spine id. -------------------
  const item = db.select().from(briefItems).where(eq(briefItems.id, briefItemId)).get();
  if (!item) throw new Error(`applyReaction: no brief_items row id=${briefItemId}`);

  const citedRecord = item.citedRecord as CitedRecord | null;
  const factTarget = item.factTarget as FactTarget | null;
  const triggerDetail = item.triggerDetail ?? "";
  const kidSpineId = resolveKidSpineId(citedRecord, item.kidId, lookupKidRow);
  const contextPath = opts.contextPath;
  const isFamilyLevel = kidSpineId === FAMILY_SPINE_ID;

  // --- 3. Dispatch by reaction. ---------------------------------------------
  switch (reaction) {
    case "tell_more":
      // No mutation; reveal why the item fired.
      return { kind: "reveal_reasoning", reasoning: item.reasoning, reactionId };

    case "handled": {
      upsertSuppression(kidSpineId, triggerDetail, reactionId, factTarget, contextPath);
      let detail: string | null = null;
      // Family-level items have no kid record to fact-update — suppression only.
      if (factTarget && !isFamilyLevel) {
        detail = await applyFactTarget(kidSpineId, factTarget, contextPath);
      }
      // North-star proxy: a "Handled" tap is a candidate anticipatory-delight moment.
      db.insert(delightCandidates).values({ briefItemId, kidSpineId, triggerDetail }).run();
      return detail
        ? { kind: "fact_updated", detail, reactionId }
        : { kind: "suppressed", reactionId };
    }

    case "already_knew": {
      upsertSuppression(kidSpineId, triggerDetail, reactionId, factTarget, contextPath);
      // For developmental items, mirror the "we already know this" into the spine.
      // Family-level items have no kid subtree to write — suppression only.
      if (factTarget?.kind === "milestone" && !isFamilyLevel) {
        await clearMilestone(kidSpineId, factTarget.id, contextPath);
        await addThingWeAlreadyKnow(kidSpineId, factTarget.id, contextPath);
      }
      // NO delight row — "already knew" isn't an anticipatory-delight signal.
      return { kind: "suppressed", reactionId };
    }

    case "wrong": {
      if (!citedRecord) {
        throw new Error(
          `applyReaction: "wrong" on item ${briefItemId} has no citedRecord to quarantine`,
        );
      }
      // Family-level items have no kid record to quarantine or auto-correct. Log
      // the factual_error against the family sentinel, flip the reaction status,
      // but DO NOT quarantine (there's no kid subtree) and DO NOT park for the
      // LLM correction path. Tell the user we noted it but can't auto-correct.
      if (isFamilyLevel) {
        db.transaction(() => {
          db.insert(factualErrors)
            .values({ briefItemId, kidSpineId, citedRecord, resolvedAt: null })
            .run();
          db.update(reactions)
            .set({ appliedStatus: "n/a" })
            .where(eq(reactions.id, reactionId))
            .run();
        });
        return { kind: "fact_updated", detail: "noted; can't auto-correct family-level items", reactionId };
      }

      // Kid-level "wrong": quarantine + log + park, atomically (F8) so a crash
      // can't leave a live quarantine with the reaction stuck off-pending.
      db.transaction(() => {
        quarantineRecord(kidSpineId, citedRecord.path, "user flagged wrong");
        db.insert(factualErrors)
          .values({ briefItemId, kidSpineId, citedRecord, resolvedAt: null })
          .run();
        // Park the correction for U8 (the async LLM applier).
        db.update(reactions).set({ appliedStatus: "pending" }).where(eq(reactions.id, reactionId)).run();
      });
      return { kind: "quarantined", needsCorrection: true, reactionId };
    }

    default: {
      const _exhaustive: never = reaction;
      throw new Error(`applyReaction: unhandled reaction "${_exhaustive as string}"`);
    }
  }
}

// =============================================================================
// kidSpineId resolution
// =============================================================================

/** DB lookup of a kid row's name + spine_id by integer id (for resolveKidSpineId). */
function lookupKidRow(kidId: number): { name: string | null; spineId: string | null } | null {
  return (
    db
      .select({ name: kidsTable.name, spineId: kidsTable.spineId })
      .from(kidsTable)
      .where(eq(kidsTable.id, kidId))
      .get() ?? null
  );
}

// =============================================================================
// Suppression upsert + per-family revalidation mapping
// =============================================================================

/**
 * Upsert an active suppression on (kidSpineId, triggerDetail). If a row already
 * exists, update it in place; else insert. The revalidationKind + params are
 * derived from the triggerDetail family (see `deriveRevalidation`).
 */
function upsertSuppression(
  kidSpineId: string,
  triggerDetail: string,
  reactionId: number,
  factTarget: FactTarget | null,
  contextPath?: string,
): void {
  const { kind, params } = deriveRevalidation(kidSpineId, triggerDetail, factTarget, contextPath);

  const existing = db
    .select({ id: suppressions.id })
    .from(suppressions)
    .where(
      and(eq(suppressions.kidSpineId, kidSpineId), eq(suppressions.triggerDetail, triggerDetail)),
    )
    .get();

  if (existing) {
    db.update(suppressions)
      .set({ revalidationKind: kind, revalidationParams: params, sourceReactionId: reactionId })
      .where(eq(suppressions.id, existing.id))
      .run();
  } else {
    db.insert(suppressions)
      .values({
        kidSpineId,
        triggerDetail,
        revalidationKind: kind,
        revalidationParams: params,
        sourceReactionId: reactionId,
      })
      .run();
  }
}

type Revalidation = { kind: RevalidationKind; params: Record<string, unknown> | null };

/** outgrowing sub-type → measurement type the band tracks. */
const OUTGROWING_MEASUREMENT: Record<string, MeasurementType> = {
  shoes: "shoe_size_us",
  clothing: "clothing_size_months",
  carseat: "weight_kg",
  sleep_sack: "weight_kg",
};

function deriveRevalidation(
  kidSpineId: string,
  triggerDetail: string,
  factTarget: FactTarget | null,
  contextPath?: string,
): Revalidation {
  const family = triggerDetail.split(":")[0] ?? "";
  const sub = triggerDetail.includes(":") ? triggerDetail.slice(triggerDetail.indexOf(":") + 1) : "";

  switch (family) {
    case "outgrowing": {
      const type = OUTGROWING_MEASUREMENT[sub];
      if (!type) return { kind: "forever", params: null };
      const latest = latestMeasurement(kidSpineId, type);
      // No measurement to band against → stay suppressed until the record changes.
      if (!latest) return { kind: "forever", params: null };
      return {
        kind: "measurement_band",
        params: { type, value: latest.value, measuredOn: latest.measuredOn },
      };
    }

    case "developmental": {
      const milestoneId = factTarget?.kind === "milestone" ? factTarget.id : sub;
      if (!milestoneId) return { kind: "forever", params: null };
      return { kind: "until_milestone_change", params: { milestoneId } };
    }

    case "absence":
      // Well-visit / absence items: a tap can't supply the NEXT visit date, so a
      // deterministic write would be a no-op that resurfaces immediately (F5).
      // Stay suppressed `forever` — it won't resurface until the spine's visit
      // data actually changes (when the user logs the real visit through the
      // existing flow), at which point the citing record changes.
      return { kind: "forever", params: null };

    case "vaccine_prep": {
      const date = nextWellVisitDate(kidSpineId, contextPath);
      if (date) return { kind: "until_date", params: { date } };
      return { kind: "forever", params: null };
    }

    default:
      // medication_followup, crossproduct, and anything else.
      return { kind: "forever", params: null };
  }
}

// =============================================================================
// Spine reads (deterministic helpers)
// =============================================================================

/** Latest measurement of `type` for the kid (by spine id), or null. */
function latestMeasurement(
  kidSpineId: string,
  type: MeasurementType,
): { value: number; measuredOn: string } | null {
  const kid = db
    .select({ id: kidsTable.id })
    .from(kidsTable)
    .where(eq(kidsTable.spineId, kidSpineId))
    .get();
  if (!kid) return null;

  const row = db
    .select({ value: measurements.value, measuredOn: measurements.measuredOn })
    .from(measurements)
    .where(and(eq(measurements.kidId, kid.id), eq(measurements.type, type)))
    .orderBy(desc(measurements.measuredOn))
    .get();
  return row ?? null;
}

/** Read the spine's medical.next_well_visit.date for this kid, if present. */
function nextWellVisitDate(kidSpineId: string, contextPath?: string): string | null {
  const result = loadFamilyContext(contextPath);
  if (result.status !== "ok") return null;
  const kid = getKid(result.context, kidSpineId);
  if (!kid) return null;
  const medical = (kid as Record<string, unknown>)["medical"];
  if (typeof medical !== "object" || medical === null) return null;
  const next = (medical as Record<string, unknown>)["next_well_visit"];
  if (typeof next !== "object" || next === null) return null;
  const date = (next as Record<string, unknown>)["date"];
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return null;
}

// =============================================================================
// Spine fact mutation (clean-case deterministic targets)
// =============================================================================

/**
 * Apply the deterministic spine mutator for a factTarget; return a human detail,
 * or null when the factTarget is suppression-only (no honest deterministic
 * spine write a tap can make).
 */
async function applyFactTarget(
  kidSpineId: string,
  factTarget: FactTarget,
  contextPath?: string,
): Promise<string | null> {
  switch (factTarget.kind) {
    case "allergen":
      await markAllergenIntroduced(kidSpineId, factTarget.allergen, contextPath);
      return `${factTarget.allergen} marked introduced`;
    case "milestone":
      await clearMilestone(kidSpineId, factTarget.id, contextPath);
      return `${factTarget.id} cleared`;
    case "well_visit":
      // A tap can't know the NEXT visit date, so there is no honest deterministic
      // spine write here (writing the current date back is a no-op that resurfaces
      // the item immediately). This is suppression-only; the spine's visit data
      // changes when the user logs the actual visit through the existing flow.
      // The absence-family revalidation is set to `forever` so it won't resurface
      // until then (see deriveRevalidation).
      return null;
    default: {
      const _exhaustive: never = factTarget;
      throw new Error(`applyFactTarget: unhandled factTarget ${JSON.stringify(_exhaustive)}`);
    }
  }
}

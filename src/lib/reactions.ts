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
  getKid,
  loadFamilyContext,
  spineIdFromName,
} from "./context.js";
import {
  markAllergenIntroduced,
  clearMilestone,
  addThingWeAlreadyKnow,
  advanceWellVisitDue,
  quarantineRecord,
} from "./spine_write.js";

// =============================================================================
// Result shape — tells the bot what to show
// =============================================================================

export type ReactionResult =
  | { kind: "suppressed" }
  | { kind: "fact_updated"; detail: string }
  | { kind: "quarantined"; needsCorrection: true }
  | { kind: "reveal_reasoning"; reasoning: string }
  | { kind: "noop_duplicate" };

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
  if (prior) return { kind: "noop_duplicate" };

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
  const kidSpineId = resolveKidSpineId(citedRecord, item.kidId, opts.contextPath);
  const contextPath = opts.contextPath;

  // --- 3. Dispatch by reaction. ---------------------------------------------
  switch (reaction) {
    case "tell_more":
      // No mutation; reveal why the item fired.
      return { kind: "reveal_reasoning", reasoning: item.reasoning };

    case "handled": {
      upsertSuppression(kidSpineId, triggerDetail, reactionId, factTarget, contextPath);
      let detail: string | null = null;
      if (factTarget) {
        detail = await applyFactTarget(kidSpineId, factTarget, contextPath);
      }
      // North-star proxy: a "Handled" tap is a candidate anticipatory-delight moment.
      db.insert(delightCandidates).values({ briefItemId, kidSpineId, triggerDetail }).run();
      return detail ? { kind: "fact_updated", detail } : { kind: "suppressed" };
    }

    case "already_knew": {
      upsertSuppression(kidSpineId, triggerDetail, reactionId, factTarget, contextPath);
      // For developmental items, mirror the "we already know this" into the spine.
      if (factTarget?.kind === "milestone") {
        await clearMilestone(kidSpineId, factTarget.id, contextPath);
        await addThingWeAlreadyKnow(kidSpineId, factTarget.id, contextPath);
      }
      // NO delight row — "already knew" isn't an anticipatory-delight signal.
      return { kind: "suppressed" };
    }

    case "wrong": {
      if (!citedRecord) {
        throw new Error(
          `applyReaction: "wrong" on item ${briefItemId} has no citedRecord to quarantine`,
        );
      }
      quarantineRecord(kidSpineId, citedRecord.path, "user flagged wrong");
      db.insert(factualErrors)
        .values({ briefItemId, kidSpineId, citedRecord, resolvedAt: null })
        .run();
      // Park the correction for U8 (the async LLM applier).
      db.update(reactions).set({ appliedStatus: "pending" }).where(eq(reactions.id, reactionId)).run();
      return { kind: "quarantined", needsCorrection: true };
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

/**
 * Prefer the citedRecord's spine id, else the kids row's spine_id, else derive
 * a slug from the kid's name. Throw if nothing resolves — never partial-write.
 */
function resolveKidSpineId(
  citedRecord: CitedRecord | null,
  kidId: number | null,
  contextPath?: string,
): string {
  if (citedRecord?.kidSpineId) return citedRecord.kidSpineId;

  if (kidId !== null) {
    const row = db
      .select({ name: kidsTable.name, spineId: kidsTable.spineId })
      .from(kidsTable)
      .where(eq(kidsTable.id, kidId))
      .get();
    if (row?.spineId) return row.spineId;
    if (row?.name) return spineIdFromName(row.name);
  }

  throw new Error(
    `applyReaction: cannot resolve kidSpineId (citedRecord=${JSON.stringify(
      citedRecord,
    )}, kidId=${kidId})`,
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

/** Apply the deterministic spine mutator for a factTarget; return a human detail. */
async function applyFactTarget(
  kidSpineId: string,
  factTarget: FactTarget,
  contextPath?: string,
): Promise<string> {
  switch (factTarget.kind) {
    case "allergen":
      await markAllergenIntroduced(kidSpineId, factTarget.allergen, contextPath);
      return `${factTarget.allergen} marked introduced`;
    case "milestone":
      await clearMilestone(kidSpineId, factTarget.id, contextPath);
      return `${factTarget.id} cleared`;
    case "well_visit": {
      const date = nextWellVisitDate(kidSpineId, contextPath);
      if (date) await advanceWellVisitDue(kidSpineId, date, contextPath);
      return "well visit recorded";
    }
    default: {
      const _exhaustive: never = factTarget;
      throw new Error(`applyFactTarget: unhandled factTarget ${JSON.stringify(_exhaustive)}`);
    }
  }
}

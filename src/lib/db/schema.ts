import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// =============================================================================
// Kids
// =============================================================================
// One row per kid. `notes` is free-form context fed into LLM prompts.
export const kids = sqliteTable("kids", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  dob: text("dob").notNull(), // ISO date YYYY-MM-DD
  pediatrician: text("pediatrician"),
  daycare: text("daycare"),
  notes: text("notes"),
  // Stable link to the family_context.json kid string id (e.g. "kid_a"). Bridges
  // the DB integer id to the spine id for reaction-driven spine mutations.
  spineId: text("spine_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// =============================================================================
// Measurements (append-only — trajectory is the signal)
// =============================================================================
// Numeric measurements only. Clothing sizes are stored as months
// (e.g. 24 = "2T", 36 = "3T"). Convention documented in README.
export const MEASUREMENT_TYPES = [
  "weight_kg",
  "height_cm",
  "head_circ_cm",
  "shoe_size_us",
  "clothing_size_months",
] as const;
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number];

export const measurements = sqliteTable(
  "measurements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kidId: integer("kid_id")
      .notNull()
      .references(() => kids.id),
    type: text("type", { enum: MEASUREMENT_TYPES }).notNull(),
    value: real("value").notNull(),
    unit: text("unit").notNull(), // matches/clarifies the type's implied unit
    measuredOn: text("measured_on").notNull(), // ISO date
    source: text("source"), // 'pediatrician' | 'home' | 'manual' | etc.
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    kidTypeIdx: index("measurements_kid_type_idx").on(t.kidId, t.type),
    measuredOnIdx: index("measurements_measured_on_idx").on(t.measuredOn),
  }),
);

// =============================================================================
// Events (append-only — facts in the family record)
// =============================================================================
// `gear_purchase` is the most important type for the Outgrowing engine —
// `metadata` should include item details (e.g. {"item":"shoes","brand":"Stride Rite","size":8}).
export const EVENT_TYPES = [
  "well_visit",
  "vaccine",
  "milestone",
  "gear_purchase",
  "illness",
  "note",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kidId: integer("kid_id")
      .notNull()
      .references(() => kids.id),
    type: text("type", { enum: EVENT_TYPES }).notNull(),
    occurredOn: text("occurred_on").notNull(), // ISO date
    description: text("description"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    kidTypeIdx: index("events_kid_type_idx").on(t.kidId, t.type),
    occurredOnIdx: index("events_occurred_on_idx").on(t.occurredOn),
  }),
);

// =============================================================================
// Briefs (Sunday-morning weekly briefing)
// =============================================================================
export const briefs = sqliteTable("briefs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  generatedAt: text("generated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  weekOf: text("week_of").notNull(), // ISO date — Sunday of the week
  recipients: text("recipients", { mode: "json" }).$type<string[]>().notNull(),
});

// =============================================================================
// BriefItems (the line items inside a brief)
// =============================================================================
// Provenance is mandatory — that's how we eval.
export const TRIGGER_SOURCES = ["lookahead", "schedule", "seasonal"] as const;
export type TriggerSource = (typeof TRIGGER_SOURCES)[number];

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

// A machine-readable pointer back to the exact spine record a candidate reasoned
// from. Reactions read this (not the coarse triggerDetail) so quarantine and
// suppression target a concrete record.
export type CitedRecord = { kidSpineId: string; path: string };

// The deterministic clean-case mutation a reaction applies, when one exists.
// Engines populate this for the cases with an unambiguous spine target.
export type FactTarget =
  | { kind: "allergen"; allergen: string }
  | { kind: "milestone"; id: string }
  | { kind: "well_visit" };

export const briefItems = sqliteTable(
  "brief_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    briefId: integer("brief_id")
      .notNull()
      .references(() => briefs.id),
    kidId: integer("kid_id").references(() => kids.id), // nullable: family-level items
    headline: text("headline").notNull(),
    body: text("body").notNull(),
    suggestedAction: text("suggested_action"),
    triggerSource: text("trigger_source", { enum: TRIGGER_SOURCES }).notNull(),
    triggerDetail: text("trigger_detail"), // sub-category, e.g. "outgrowing" or "developmental"
    reasoning: text("reasoning").notNull(), // why this item fired (for eval + R2 trust)
    confidence: text("confidence", { enum: CONFIDENCE_LEVELS }).notNull(),
    priority: integer("priority").notNull(),
    // The current_edges entry this item relates to (v2.1 spec). Used by the
    // assembler for priority-boost and by the polish prompt for voice.
    relatedToCurrentEdge: text("related_to_current_edge"),
    // --- Weekly loop (delivery + reaction binding) ---
    telegramMessageId: integer("telegram_message_id"), // set on delivery; binds reactions
    deliveredAt: text("delivered_at"), // ISO timestamp; null until the send succeeds (R4)
    // The spine record this item reasoned from. Reactions read this so a tap maps
    // to a concrete record for quarantine/suppression/fact-update.
    citedRecord: text("cited_record", { mode: "json" }).$type<CitedRecord | null>(),
    // The clean-case deterministic mutation descriptor, when one applies (else null).
    factTarget: text("fact_target", { mode: "json" }).$type<FactTarget | null>(),
  },
  (t) => ({
    briefIdx: index("brief_items_brief_idx").on(t.briefId),
  }),
);

// =============================================================================
// Feedback (per-item ratings) — DEPRECATED
// =============================================================================
// Superseded by the `reactions` table below (weekly loop). Left in place to avoid
// a destructive db:push; do not write to this table in new code.
export const FEEDBACK_RATINGS = [
  "hit",
  "handled",
  "irrelevant",
  "surprise",
] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

export const feedback = sqliteTable("feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  briefItemId: integer("brief_item_id")
    .notNull()
    .references(() => briefItems.id),
  rating: text("rating", { enum: FEEDBACK_RATINGS }).notNull(),
  note: text("note"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// =============================================================================
// Weekly loop — reactions, suppressions, quarantines, factual errors, delight
// =============================================================================
// Each tap on a delivered brief item lands in `reactions`. The four-token grammar
// supersedes the FEEDBACK_RATINGS enum above.
export const REACTION_KINDS = ["handled", "already_knew", "wrong", "tell_more"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

// Lifecycle of a "wrong" reaction's correction: n/a (non-wrong reactions),
// pending (awaiting/holding a correction), applied (diff landed), parked (held for
// manual fix because the LLM could not confidently/safely place it).
export const APPLIED_STATUSES = ["n/a", "pending", "applied", "parked"] as const;
export type AppliedStatus = (typeof APPLIED_STATUSES)[number];

export const reactions = sqliteTable(
  "reactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    briefItemId: integer("brief_item_id")
      .notNull()
      .references(() => briefItems.id),
    reaction: text("reaction", { enum: REACTION_KINDS }).notNull(),
    telegramCallbackId: text("telegram_callback_id"), // dedupe re-taps / 24h backlog
    promptMessageId: integer("prompt_message_id"), // force_reply prompt msg id (wrong)
    replyMessageId: integer("reply_message_id"), // correction reply msg id (reply dedupe)
    correctionText: text("correction_text"),
    appliedStatus: text("applied_status", { enum: APPLIED_STATUSES })
      .notNull()
      .default("n/a"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    briefItemIdx: index("reactions_brief_item_idx").on(t.briefItemId),
    callbackIdx: index("reactions_callback_idx").on(t.telegramCallbackId),
  }),
);

// How a suppression is re-validated at generation time (never permanent mute).
export const REVALIDATION_KINDS = [
  "measurement_band", // suppressed until a newer measurement crosses the recorded band
  "until_milestone_change", // suppressed until the milestone status regresses
  "until_date", // suppressed until a stored date passes
  "forever", // suppressed until the record changes / explicit un-suppress
] as const;
export type RevalidationKind = (typeof REVALIDATION_KINDS)[number];

export const suppressions = sqliteTable(
  "suppressions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kidSpineId: text("kid_spine_id").notNull(),
    triggerDetail: text("trigger_detail").notNull(),
    revalidationKind: text("revalidation_kind", { enum: REVALIDATION_KINDS }).notNull(),
    revalidationParams: text("revalidation_params", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    sourceReactionId: integer("source_reaction_id").references(() => reactions.id),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    kidTriggerIdx: index("suppressions_kid_trigger_idx").on(t.kidSpineId, t.triggerDetail),
  }),
);

// A "wrong"-flagged spine record, quarantined so no item citing it re-fires until
// the correction lands.
export const quarantines = sqliteTable(
  "quarantines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kidSpineId: text("kid_spine_id").notNull(),
    recordPath: text("record_path").notNull(), // the cited spine path
    reason: text("reason"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    liftedAt: text("lifted_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    kidActiveIdx: index("quarantines_kid_active_idx").on(t.kidSpineId, t.active),
  }),
);

// Counter-metric log: one row per "wrong" tap; resolvedAt set when corrected.
export const factualErrors = sqliteTable("factual_errors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  briefItemId: integer("brief_item_id")
    .notNull()
    .references(() => briefItems.id),
  kidSpineId: text("kid_spine_id").notNull(),
  citedRecord: text("cited_record", { mode: "json" }).$type<CitedRecord | null>(),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Raw North-Star signal store. No V1 consumer reads it (automated delight→ranking
// is deferred). A "Handled" tap is a proxy, not a verified anticipatory-delight moment.
export const delightCandidates = sqliteTable("delight_candidates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  briefItemId: integer("brief_item_id")
    .notNull()
    .references(() => briefItems.id),
  kidSpineId: text("kid_spine_id").notNull(),
  triggerDetail: text("trigger_detail"), // engine attribution
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// =============================================================================
// Type exports for app code
// =============================================================================
export type Kid = typeof kids.$inferSelect;
export type NewKid = typeof kids.$inferInsert;

export type Measurement = typeof measurements.$inferSelect;
export type NewMeasurement = typeof measurements.$inferInsert;

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

export type Brief = typeof briefs.$inferSelect;
export type NewBrief = typeof briefs.$inferInsert;

export type BriefItem = typeof briefItems.$inferSelect;
export type NewBriefItem = typeof briefItems.$inferInsert;

export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;

export type Reaction = typeof reactions.$inferSelect;
export type NewReaction = typeof reactions.$inferInsert;

export type Suppression = typeof suppressions.$inferSelect;
export type NewSuppression = typeof suppressions.$inferInsert;

export type Quarantine = typeof quarantines.$inferSelect;
export type NewQuarantine = typeof quarantines.$inferInsert;

export type FactualError = typeof factualErrors.$inferSelect;
export type NewFactualError = typeof factualErrors.$inferInsert;

export type DelightCandidate = typeof delightCandidates.$inferSelect;
export type NewDelightCandidate = typeof delightCandidates.$inferInsert;

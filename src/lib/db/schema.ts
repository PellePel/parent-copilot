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
  },
  (t) => ({
    briefIdx: index("brief_items_brief_idx").on(t.briefId),
  }),
);

// =============================================================================
// Feedback (per-item ratings — drives Stage 2 eval, post-MVP)
// =============================================================================
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

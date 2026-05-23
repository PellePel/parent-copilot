/**
 * Calendar cross-products engine — the third (and most uncanny) half of
 * Lookahead.
 *
 * Sends Claude a structured snapshot of each kid (DOB/age, latest
 * measurements, recent events, notes) along with upcoming calendar events,
 * and asks for candidates where the intersection produces something
 * actionable a parent would otherwise miss. The PRD's canonical example:
 * "Maine trip in 3 weeks + Jude's swim diapers from last summer were size
 * 6m, he's now in 9m → buy new swim diapers."
 *
 * Why an LLM: calendar event titles are unstructured. Heuristic keyword
 * matching is brittle ("trip" might be a business trip, "party" might be a
 * work party). Claude reasons across the strings and the family state to
 * produce specific cross-products.
 *
 * Discipline (R2): system prompt biases hard toward sparseness — "silent is
 * better than spammy." Every candidate must cite specific facts from the
 * inputs. Don't invent.
 *
 * Skip conditions (silent, no errors):
 *   - No calendar events
 *   - No API key
 *   - API failure or schema-mismatched response
 */

import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ageInMonths, formatAge, todayIso } from "../age.js";
import type { CalendarEvent } from "../calendar.js";
import { db } from "../db/index.js";
import {
  events,
  measurements,
  type Kid,
  type Measurement,
  type Event,
} from "../db/schema.js";
import { firedInLast } from "./suppression.js";
import type { Candidate } from "./types.js";

const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 4096;
const SUPPRESSION_WINDOW_WEEKS = 4;
const SCORE_BY_CONFIDENCE: Record<string, number> = {
  high: 78,
  medium: 65,
  low: 52,
};

const SYSTEM_PROMPT = `You are the cross-product reasoner for a weekly parenting brief — a Sunday-morning email a parent reads in two minutes.

You receive a structured snapshot of each kid (age, latest measurements, recent gear purchases, notes) AND the family's upcoming calendar events (next 14 days). Your job: find the small number of items where the calendar AND the family state intersect in a way the parent might miss.

The canonical example: "Trip to Maine next week. Jude's swim diapers from last summer were size 6m, but he's in 9m clothes now — get new swim diapers."

Rules:
- Be sparse. Silent is better than spammy. Empty array is a fine response.
- Skip routine events (school day, work block, regular weekly thing) unless something unusual applies.
- DON'T produce generic packing reminders. The point is the CROSS-PRODUCT: combine specific calendar facts with specific family-state facts.
- DON'T invent facts that aren't in the inputs. If you're guessing a connection, skip it.
- DON'T produce items already handled by the dedicated engines:
  * Outgrowing (shoes, clothes, carseat weight)
  * Developmental windows (age-banded heads-ups)
  * Well-visit absence (well-visit is age-due but not on calendar)
  These have their own engines; your job is the residual.
- If the calendar event is itself a well-visit on the schedule, you CAN flag prep items (what to ask the pediatrician, what vaccines might be due) — but only if there's something specific worth noting.

Voice:
- Conversational. Contractions are fine.
- Concrete. Cite the calendar event by name and date. Cite the kid state that combines with it.
- No lecturing.

Length:
- Headline under 80 chars.
- Body under 80 words.
- Suggested action under 35 words.

Confidence:
- high: facts directly support the inference (e.g. specific gear-purchase event from last summer for a child whose current size has changed).
- medium: reasonable inference from age + event type.
- low: speculative; only use if the cost of missing is much higher than the cost of being wrong.

Return JSON via the submit_items tool. If nothing meaningful, return { "items": [] }.`;

const ResponseItem = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_-]+$/, "id must be lowercase slug"),
  kid_id: z.union([z.number().int().positive(), z.null()]),
  headline: z.string().min(1),
  body: z.string().min(1),
  suggested_action: z.string().optional(),
  reasoning: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
});

const ResponsePayload = z.object({
  items: z.array(ResponseItem),
});

const TOOL_DEFINITION = {
  name: "submit_items",
  description: "Submit zero or more cross-product items.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Stable lowercase-slug id, unique per item.",
            },
            kid_id: {
              type: ["number", "null"],
              description: "Which kid this is about; null for family-level.",
            },
            headline: { type: "string" },
            body: { type: "string" },
            suggested_action: { type: "string" },
            reasoning: {
              type: "string",
              description:
                "What facts from the inputs combined to produce this. Cite the event and the relevant kid state.",
            },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["id", "kid_id", "headline", "body", "reasoning", "confidence"],
        },
      },
    },
    required: ["items"],
  },
};

// =============================================================================
// Snapshot builders — what we send to Claude per kid
// =============================================================================

type KidSnapshot = {
  id: number;
  name: string;
  dob: string;
  age: string;
  notes?: string | null;
  recent_measurements: Array<{ type: string; value: number; unit: string; measured_on: string }>;
  recent_events: Array<{
    type: string;
    occurred_on: string;
    description: string | null;
    metadata: Record<string, unknown> | null;
  }>;
};

function snapshotKid(kid: Kid, asOf: string): KidSnapshot {
  // Most recent measurement per type (up to 8 distinct types).
  const measRows = db
    .select()
    .from(measurements)
    .where(eq(measurements.kidId, kid.id))
    .orderBy(desc(measurements.measuredOn))
    .all();
  const seenTypes = new Set<string>();
  const recentMeasurements: KidSnapshot["recent_measurements"] = [];
  for (const m of measRows as Measurement[]) {
    if (seenTypes.has(m.type)) continue;
    seenTypes.add(m.type);
    recentMeasurements.push({
      type: m.type,
      value: m.value,
      unit: m.unit,
      measured_on: m.measuredOn,
    });
    if (recentMeasurements.length >= 8) break;
  }

  // Recent events (last 10), with focus on gear_purchase and well_visit.
  const eventRows = db
    .select()
    .from(events)
    .where(eq(events.kidId, kid.id))
    .orderBy(desc(events.occurredOn))
    .limit(10)
    .all() as Event[];

  return {
    id: kid.id,
    name: kid.name,
    dob: kid.dob,
    age: formatAge(kid.dob, asOf),
    notes: kid.notes,
    recent_measurements: recentMeasurements,
    recent_events: eventRows.map((e) => ({
      type: e.type,
      occurred_on: e.occurredOn,
      description: e.description,
      metadata: e.metadata as Record<string, unknown> | null,
    })),
  };
}

// =============================================================================
// Public API
// =============================================================================

type CrossProductOptions = {
  apiKey?: string;
  model?: string;
};

export async function crossProductCandidatesFor(
  kids: Kid[],
  upcomingEvents: CalendarEvent[],
  asOf: string = todayIso(),
  options: CrossProductOptions = {},
): Promise<Candidate[]> {
  if (kids.length === 0) return [];
  if (upcomingEvents.length === 0) return [];

  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn(
      "Cross-products: ANTHROPIC_API_KEY not set; skipping calendar reasoning.",
    );
    return [];
  }

  const snapshot = {
    as_of: asOf,
    kids: kids.map((k) => snapshotKid(k, asOf)),
    upcoming_events: upcomingEvents.map((e) => ({
      id: e.id,
      summary: e.summary,
      start: e.start,
      end: e.end,
      description: e.description,
      location: e.location,
    })),
  };

  const client = new Anthropic({ apiKey });
  let toolInput: unknown;
  try {
    const response = await client.messages.create({
      model: options.model ?? MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [TOOL_DEFINITION],
      tool_choice: { type: "tool", name: TOOL_DEFINITION.name },
      messages: [
        {
          role: "user",
          content:
            "Here's this week's snapshot. Find cross-product items per the rules. Empty array if nothing meaningful.\n\n" +
            JSON.stringify(snapshot, null, 2),
        },
      ],
    });
    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      console.warn("Cross-products: model didn't return a tool_use block. Skipping.");
      return [];
    }
    toolInput = toolBlock.input;
  } catch (err) {
    console.warn(
      `Cross-products: Anthropic API call failed (${err instanceof Error ? err.message : String(err)}). Skipping.`,
    );
    return [];
  }

  const parsed = ResponsePayload.safeParse(toolInput);
  if (!parsed.success) {
    console.warn(
      `Cross-products: tool response failed schema validation (${parsed.error.issues[0]?.message}). Skipping.`,
    );
    return [];
  }

  const validKidIds = new Set(kids.map((k) => k.id));
  const candidates: Candidate[] = [];
  for (const item of parsed.data.items) {
    if (item.kid_id !== null && !validKidIds.has(item.kid_id)) {
      console.warn(
        `Cross-products: item "${item.id}" references unknown kid_id=${item.kid_id}. Skipping that item.`,
      );
      continue;
    }
    const triggerDetail = `crossproduct:${item.id}`;
    // Suppression key is kidId-scoped; family-level items use 0 as a stand-in
    // (no kid has id=0). Since (kidId, triggerDetail) is the dedup key in the
    // assembler too, this keeps family-level items separated from per-kid ones.
    const suppressionKidId = item.kid_id ?? 0;
    if (firedInLast(suppressionKidId, triggerDetail, SUPPRESSION_WINDOW_WEEKS, asOf)) {
      continue;
    }
    candidates.push({
      kidId: item.kid_id,
      headline: item.headline,
      body: item.body,
      suggestedAction: item.suggested_action,
      triggerSource: "lookahead",
      triggerDetail,
      reasoning: `[crossproduct] ${item.reasoning}`,
      confidence: item.confidence,
      rawScore: SCORE_BY_CONFIDENCE[item.confidence] ?? 60,
    });
  }
  return candidates;
}

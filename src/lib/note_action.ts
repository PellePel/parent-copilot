/**
 * Note → forecast → action pipeline (U6).
 *
 * A note compounds into forward value, never a stored receipt. The raw note is
 * persisted immediately (so it's never lost); an async LLM step then derives a
 * forecast + recommended action. For a weight-keyed note the model supplies a
 * target weight and DETERMINISTIC code computes BOTH a `surface_on_or_after`
 * date (≈2 weeks before the projected crossing) AND a `clear_when` weight band
 * (auto-clear once the kid actually crosses) — honoring AE2 on one row.
 *
 * Script-produces / model-presents: the LLM writes prose + the threshold; code
 * owns the dates and bands. Client injection mirrors correct.ts so tests run
 * without a network call. Derivation failure leaves the raw note intact and
 * surfaces nothing broken.
 */

import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";

import { ageInMonths, todayIso } from "./age.js";
import { db } from "./db/index.js";
import { kids as kidsTable, measurements, noteActions, type ClearWhen } from "./db/schema.js";
import { lbToKg } from "./kb/gear.js";
import { weeksUntilTargetWeight } from "./kb/outgrowing.js";
import type { NoteActionView } from "./engine/week_view.js";

const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 1024;
const SURFACE_LEAD_WEEKS = 2; // surface a one-shot action this far before the crossing

export type NoteClient = {
  messages: {
    create: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
  };
};

const SYSTEM_PROMPT = `You turn a parent's free-text note about their child into a forward-looking forecast and ONE concrete recommended action. The note is context the parent wants the system to act on, not a task to store verbatim.

Return your result via the submit_note_action tool:
- forecastText: one or two sentences stating what is coming or what to expect, in the parent's near future. Forward-looking, specific.
- actionText: ONE concrete next step the parent can take. Imperative, short.
- weightThresholdLb: include ONLY when the note implies a gear or care transition that happens at a specific child weight (e.g. "bigger sleep sack at 18 lb", "next car seat at 22 lb"). Set it to that weight in pounds. Omit otherwise.

Never invent medical advice. Keep it practical and warm.`;

const TOOL_DEFINITION = {
  name: "submit_note_action",
  description: "Submit the forecast + recommended action derived from the note.",
  input_schema: {
    type: "object" as const,
    properties: {
      forecastText: { type: "string", description: "Forward-looking forecast, 1-2 sentences." },
      actionText: { type: "string", description: "One concrete next step, imperative." },
      weightThresholdLb: {
        type: "number",
        description: "The child weight (lb) at which the transition happens, when the note implies one. Omit otherwise.",
      },
    },
    required: ["forecastText", "actionText"],
  },
};

const NoteActionDerivation = z.object({
  forecastText: z.string().min(1),
  actionText: z.string().min(1),
  weightThresholdLb: z.number().positive().optional(),
});

export type DeriveResult = { status: "derived" | "skipped"; reason?: string };

type Options = { client?: NoteClient; asOf?: string };

/** Persist the raw note immediately; returns the row id. Derivation runs later. */
export function recordNote(note: string, kidSpineId: string | null): number {
  const inserted = db
    .insert(noteActions)
    .values({ sourceNote: note, kidSpineId })
    .returning({ id: noteActions.id })
    .get();
  return inserted.id;
}

/** Async derivation: LLM forecast/action + deterministic date/band, then update the row. */
export async function deriveNoteAction(noteActionId: number, opts: Options = {}): Promise<DeriveResult> {
  const row = db.select().from(noteActions).where(eq(noteActions.id, noteActionId)).get();
  if (!row) return { status: "skipped", reason: `no note_actions row id=${noteActionId}` };

  const derived = await requestDerivation(row.sourceNote, opts.client);
  if (!derived) return { status: "skipped", reason: "derivation unavailable or invalid" };

  const asOf = opts.asOf ?? todayIso();
  let actionKind: "ambient" | "one_shot" = "ambient";
  let surfaceOnOrAfter: string | null = null;
  let clearWhen: ClearWhen | null = null;

  // Weight-keyed note + known kid + a weight reading → a self-timed one-shot.
  if (derived.weightThresholdLb !== undefined && row.kidSpineId) {
    const plan = computeWeightTiming(row.kidSpineId, lbToKg(derived.weightThresholdLb), asOf);
    if (plan) {
      actionKind = "one_shot";
      surfaceOnOrAfter = plan.surfaceOnOrAfter;
      clearWhen = plan.clearWhen;
    }
  }

  db.update(noteActions)
    .set({
      forecastText: derived.forecastText,
      actionText: derived.actionText,
      actionKind,
      surfaceOnOrAfter,
      clearWhen,
    })
    .where(eq(noteActions.id, noteActionId))
    .run();

  return { status: "derived" };
}

/** Currently surfaceable note-actions: derived, not completed, date arrived, band not crossed. */
export function getActiveNoteActions(asOf: string = todayIso()): NoteActionView[] {
  const rows = db
    .select()
    .from(noteActions)
    .where(and(isNotNull(noteActions.forecastText), isNull(noteActions.completedAt)))
    .all();

  const out: NoteActionView[] = [];
  for (const r of rows) {
    if (r.surfaceOnOrAfter && r.surfaceOnOrAfter > asOf) continue; // not yet time
    if (r.clearWhen && weightHasCrossed(r.kidSpineId, r.clearWhen)) continue; // auto-cleared
    out.push({
      id: r.id,
      kidSpineId: r.kidSpineId ?? "family",
      forecastText: r.forecastText!,
      actionText: r.actionText ?? "",
      actionKind: r.actionKind ?? "ambient",
    });
  }
  return out;
}

// --- internals --------------------------------------------------------------

function kidRowFromSpine(kidSpineId: string): { id: number; dob: string } | null {
  return (
    db
      .select({ id: kidsTable.id, dob: kidsTable.dob })
      .from(kidsTable)
      .where(eq(kidsTable.spineId, kidSpineId))
      .get() ?? null
  );
}

function latestWeightKg(kidId: number): number | null {
  const row = db
    .select({ value: measurements.value })
    .from(measurements)
    .where(and(eq(measurements.kidId, kidId), eq(measurements.type, "weight_kg")))
    .orderBy(desc(measurements.measuredOn))
    .get();
  return row?.value ?? null;
}

function weightHasCrossed(kidSpineId: string | null, band: ClearWhen): boolean {
  if (!kidSpineId) return false;
  const kid = kidRowFromSpine(kidSpineId);
  if (!kid) return false;
  const latest = latestWeightKg(kid.id);
  return latest !== null && latest >= band.value;
}

function computeWeightTiming(
  kidSpineId: string,
  targetKg: number,
  asOf: string,
): { surfaceOnOrAfter: string | null; clearWhen: ClearWhen } | null {
  const kid = kidRowFromSpine(kidSpineId);
  if (!kid) return null;
  const latest = latestWeightKg(kid.id);
  if (latest === null) return null;

  const weeksToTarget = weeksUntilTargetWeight(latest, ageInMonths(kid.dob, asOf), targetKg);
  // Surface ~2 weeks before the projected crossing; surface now if already close
  // or unreachable-by-projection (we still want the standing reminder).
  const surfaceOnOrAfter =
    weeksToTarget === null || weeksToTarget <= SURFACE_LEAD_WEEKS
      ? null
      : addWeeksIso(asOf, weeksToTarget - SURFACE_LEAD_WEEKS);

  return { surfaceOnOrAfter, clearWhen: { type: "weight_kg", value: targetKg } };
}

function addWeeksIso(iso: string, weeks: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(weeks * 7));
  return d.toISOString().slice(0, 10);
}

async function requestDerivation(
  note: string,
  injected?: NoteClient,
): Promise<z.infer<typeof NoteActionDerivation> | null> {
  const client = injected ?? defaultClient();
  if (!client) return null;

  let toolInput: unknown;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [TOOL_DEFINITION],
      tool_choice: { type: "tool", name: TOOL_DEFINITION.name },
      messages: [{ role: "user", content: `Parent's note:\n\n${note}` }],
    });
    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      console.warn("Note: model didn't return a tool_use block. Skipping derivation.");
      return null;
    }
    toolInput = toolBlock.input;
  } catch (err) {
    console.warn(`Note: Anthropic API call failed (${err instanceof Error ? err.name : "error"}). Skipping.`);
    return null;
  }

  const parsed = NoteActionDerivation.safeParse(toolInput);
  if (!parsed.success) {
    console.warn("Note: tool response failed schema validation. Skipping.");
    return null;
  }
  return parsed.data;
}

function defaultClient(): NoteClient | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("Note: ANTHROPIC_API_KEY not set; cannot derive note action.");
    return null;
  }
  return new Anthropic({ apiKey });
}

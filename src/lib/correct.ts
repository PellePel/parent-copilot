/**
 * U8 — Async correction applier (the ONLY LLM step in the weekly loop).
 *
 * When a user taps "wrong" (U7), the cited spine record is quarantined and the
 * reaction is parked as `appliedStatus="pending"`. The bot (U5) later captures
 * the user's free-text correction into `reactions.correctionText` and invokes
 * this module OFF the hot path.
 *
 * This is where — and the only place where — an LLM enters the loop. Everything
 * else in the loop is deterministic. Claude's single job: turn one free-text
 * correction into a STRUCTURED, path-scoped diff `{ path, value, confident }`
 * that `applySpineDiff` can apply, OR declare it can't (confident:false) so we
 * park rather than guess.
 *
 * Discipline (R2 — trust):
 *   - Never guess. If the model isn't confident, or the JSON fails to parse, or
 *     the path escapes the kid's subtree (applySpineDiff throws), or the write
 *     would produce an invalid spine (spine_write re-validates) → PARK. Parking
 *     leaves the quarantine ACTIVE and the spine untouched; a human fixes it.
 *   - The path the model returns is asserted in-subtree by applySpineDiff. We
 *     do not trust the model to stay in bounds.
 *
 * Atomicity / crash-safety: we mutate the spine and lift the quarantine BEFORE
 * flipping `appliedStatus` to "applied". applySpineDiff is a set (idempotent)
 * and lifting an already-lifted quarantine is a no-op, so if we crash after the
 * spine write but before the status flip, the row stays "pending" and
 * reprocesses safely.
 *
 * Client injection: `opts.client` lets tests pass a stub returning a fixed
 * structured response — no real API key needed. Defaults to the real Anthropic
 * client constructed exactly as polish.ts does.
 */

import Anthropic from "@anthropic-ai/sdk";
import { and, eq, isNull, desc } from "drizzle-orm";
import { z } from "zod";

import { todayIso } from "./age.js";
import { getKid, loadFamilyContext, resolveKidSpineId } from "./context.js";
import { db } from "./db/index.js";
import {
  briefItems,
  factualErrors,
  kids as kidsTable,
  reactions,
  type CitedRecord,
} from "./db/schema.js";
import { activeQuarantines, applySpineDiff, liftQuarantine } from "./spine_write.js";

const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 1024;

// Minimal structural type for the injectable client — only the surface we call.
// The real Anthropic SDK satisfies this; test stubs implement just this much.
export type CorrectionClient = {
  messages: {
    create: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
  };
};

const SYSTEM_PROMPT = `You translate a parent's free-text correction into a single, precise spine-field diff for one child's record.

You receive: the cited record path, the CURRENT value stored at that path, why the original brief item fired, and the parent's free-text correction. Your job is to determine the ONE field that should change and its corrected value.

Rules:
- Return the diff via the submit_correction tool: { path, value, confident }.
- "path" MUST be relative to THIS kid's record (e.g. "medical.allergies[0]", "gear.shoe_size", "patterns.eating.schedule"). Do NOT prefix with "kids[...]". Do NOT target a root key (family, history, schema_version) or another child — those are out of bounds and will be rejected.
- Prefer correcting the cited path itself unless the correction clearly points at a sibling field within the same kid.
- "value" is the corrected value at that path — match the SHAPE of the current value (string stays a string, object stays the same object shape, array element stays an element). Don't restructure.
- Set "confident": true ONLY when you can pinpoint a single field and a precise corrected value from the text. If the correction is vague, multi-field, ambiguous, or you'd have to guess the value, set "confident": false (path/value can be empty). We will park it for a human rather than write a guess.

Never invent facts. When in doubt, confident:false.`;

const TOOL_DEFINITION = {
  name: "submit_correction",
  description: "Submit the single path-scoped spine diff (or decline with confident:false).",
  input_schema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description:
          "Spine path relative to this kid (dot/bracket notation). Empty allowed when confident is false.",
      },
      value: {
        description: "Corrected value at that path. Match the shape of the current value.",
      },
      confident: {
        type: "boolean",
        description:
          "true only if a single precise field+value correction is clear; false to park for a human.",
      },
    },
    required: ["path", "confident"],
  },
};

// Loose-but-validated: confident is the gate. When confident, path must be a
// non-empty string and value must be present. When not confident, we park
// regardless, so path/value are optional.
const CorrectionDiff = z.object({
  path: z.string(),
  // value may be any JSON (string, number, object, array, null). Optional so a
  // not-confident response without a value still parses.
  value: z.unknown().optional(),
  confident: z.boolean(),
});

export type CorrectionResult = { status: "applied" | "parked"; reason?: string };

type Options = {
  /** Injectable Anthropic-shaped client (tests pass a stub). */
  client?: CorrectionClient;
  /** Spine path override for tests; defaults to data/family_context.json. */
  contextPath?: string;
};

// =============================================================================
// kidSpineId resolution (shared policy in context.ts — see resolveKidSpineId)
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

/** Read the current value stored at `path` within the kid's spine record. */
function readCurrentValue(
  kidSpineId: string,
  path: string,
  contextPath?: string,
): unknown {
  const result = loadFamilyContext(contextPath);
  if (result.status !== "ok") return undefined;
  const kid = getKid(result.context, kidSpineId);
  if (!kid) return undefined;
  return getAtPath(kid as Record<string, unknown>, path);
}

/** Best-effort read of a dot/bracket path; returns undefined if it doesn't resolve. */
function getAtPath(root: Record<string, unknown>, path: string): unknown {
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let cursor: unknown = root;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path)) !== null) {
    if (cursor === null || cursor === undefined) return undefined;
    if (match[1] !== undefined) {
      if (typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
      cursor = (cursor as Record<string, unknown>)[match[1]];
    } else if (match[2] !== undefined) {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[Number(match[2])];
    }
  }
  return cursor;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Process ONE pending reaction: ask Claude for a structured diff, validate it,
 * and either apply (spine write + lift quarantine + resolve factual_error +
 * mark applied) or park. See module header for atomicity ordering.
 */
export async function applyCorrection(
  reactionId: number,
  opts: Options = {},
): Promise<CorrectionResult> {
  // --- 1. Load the reaction; require pending + a captured correction. -------
  const reaction = db.select().from(reactions).where(eq(reactions.id, reactionId)).get();
  if (!reaction) {
    return { status: "parked", reason: `no reaction row id=${reactionId}` };
  }
  if (reaction.appliedStatus !== "pending") {
    // No-op: only pending corrections are processed.
    return { status: "parked", reason: `reaction ${reactionId} not pending (${reaction.appliedStatus})` };
  }
  if (!reaction.correctionText) {
    // No-op: a pending row without captured text isn't ready.
    return { status: "parked", reason: `reaction ${reactionId} has no correctionText` };
  }

  // --- 2. Load the cited brief item + resolve the kid spine id. -------------
  const item = db.select().from(briefItems).where(eq(briefItems.id, reaction.briefItemId)).get();
  if (!item) {
    return park(reactionId, `no brief_items row id=${reaction.briefItemId}`);
  }
  const citedRecord = item.citedRecord as CitedRecord | null;
  if (!citedRecord) {
    return park(reactionId, `brief item ${item.id} has no citedRecord to correct`);
  }
  const kidSpineId = resolveKidSpineId(citedRecord, item.kidId, lookupKidRow);
  const currentValue = readCurrentValue(kidSpineId, citedRecord.path, opts.contextPath);

  // --- 3. Ask Claude for a structured, path-scoped diff. --------------------
  const diff = await requestDiff(
    {
      citedPath: citedRecord.path,
      currentValue,
      reasoning: item.reasoning,
      correctionText: reaction.correctionText,
    },
    opts.client,
  );

  // Parse failure or low confidence → park (never guess).
  if (!diff) {
    return park(reactionId, "model response failed to parse");
  }
  if (!diff.confident) {
    return park(reactionId, "model not confident in a precise single-field correction");
  }
  if (typeof diff.value === "undefined" || !diff.path) {
    return park(reactionId, "confident diff missing path or value");
  }

  // --- 4. Apply the diff. applySpineDiff asserts in-subtree AND re-validates
  // the whole spine, so an out-of-subtree path or a schema-breaking value
  // throws and we park (spine untouched). ----------------------------------
  try {
    await applySpineDiff(kidSpineId, diff.path, diff.value, opts.contextPath);
  } catch (err) {
    return park(reactionId, `applySpineDiff rejected: ${err instanceof Error ? err.message : String(err)}`);
  }

  // --- 5. Lift the quarantine that matches the cited path (no-op if already
  // lifted), resolve the factual_error, THEN mark the reaction applied last so
  // a crash mid-apply re-processes safely. ---------------------------------
  for (const q of activeQuarantines(kidSpineId)) {
    if (q.recordPath === citedRecord.path) liftQuarantine(q.id);
  }
  // Resolve only THIS reaction's unresolved factual_error — not every open error
  // for the brief item (F7). Match on briefItemId + unresolved, prefer a row
  // whose cited record matches the corrected one, and resolve the single
  // most-recent matching row.
  const openErrors = db
    .select({ id: factualErrors.id, citedRecord: factualErrors.citedRecord })
    .from(factualErrors)
    .where(
      and(
        eq(factualErrors.briefItemId, reaction.briefItemId),
        isNull(factualErrors.resolvedAt),
      ),
    )
    .orderBy(desc(factualErrors.id))
    .all();
  const target =
    openErrors.find((e) => (e.citedRecord as CitedRecord | null)?.path === citedRecord.path) ??
    openErrors[0]; // fall back to the most-recent unresolved row for this item
  if (target) {
    db.update(factualErrors)
      .set({ resolvedAt: todayIso() })
      .where(eq(factualErrors.id, target.id))
      .run();
  }
  db.update(reactions).set({ appliedStatus: "applied" }).where(eq(reactions.id, reactionId)).run();

  return { status: "applied" };
}

/**
 * Apply every pending reaction that has captured correctionText. Simple
 * sequential pass — the bot may call this, or call applyCorrection per reply.
 */
export async function applyPendingCorrections(opts: Options = {}): Promise<CorrectionResult[]> {
  const pending = db
    .select({ id: reactions.id })
    .from(reactions)
    .where(eq(reactions.appliedStatus, "pending"))
    .all();
  const results: CorrectionResult[] = [];
  for (const { id } of pending) {
    // Skip rows without captured text — applyCorrection no-ops them, but avoid
    // the lookup churn.
    const r = db
      .select({ correctionText: reactions.correctionText })
      .from(reactions)
      .where(eq(reactions.id, id))
      .get();
    if (!r?.correctionText) continue;
    results.push(await applyCorrection(id, opts));
  }
  return results;
}

// =============================================================================
// Internals
// =============================================================================

/** Mark a reaction parked: leave quarantine active, do not write the spine. */
function park(reactionId: number, reason: string): CorrectionResult {
  db.update(reactions).set({ appliedStatus: "parked" }).where(eq(reactions.id, reactionId)).run();
  return { status: "parked", reason };
}

type DiffInputs = {
  citedPath: string;
  currentValue: unknown;
  reasoning: string;
  correctionText: string;
};

/**
 * Single Claude call → validated structured diff, or null on any non-success
 * (no key / no client, API error, no tool_use block, schema mismatch). Mirrors
 * cross_products.ts: tool_choice forces the tool, then safeParse validates.
 */
async function requestDiff(
  inputs: DiffInputs,
  injected?: CorrectionClient,
): Promise<z.infer<typeof CorrectionDiff> | null> {
  const client = injected ?? defaultClient();
  if (!client) return null;

  const userPayload = {
    cited_record_path: inputs.citedPath,
    current_value: inputs.currentValue ?? null,
    why_item_fired: inputs.reasoning,
    user_correction: inputs.correctionText,
  };

  let toolInput: unknown;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [TOOL_DEFINITION],
      tool_choice: { type: "tool", name: TOOL_DEFINITION.name },
      messages: [
        {
          role: "user",
          content:
            "Here is the cited record and the parent's correction. Return a single path-scoped diff via submit_correction, or set confident:false to park.\n\n" +
            JSON.stringify(userPayload, null, 2),
        },
      ],
    });
    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      console.warn("Correct: model didn't return a tool_use block. Parking.");
      return null;
    }
    toolInput = toolBlock.input;
  } catch (err) {
    // F10: log a stable label only — raw model/API error bodies can leak the
    // payload (children's data / spine paths) we sent.
    console.warn(`Correct: Anthropic API call failed (${err instanceof Error ? err.name : "error"}). Parking.`);
    return null;
  }

  const parsed = CorrectionDiff.safeParse(toolInput);
  if (!parsed.success) {
    // F10: don't log issue messages (they can echo the offending value).
    console.warn("Correct: tool response failed schema validation. Parking.");
    return null;
  }
  return parsed.data;
}

/** Construct the real Anthropic client exactly as polish.ts does, or null. */
function defaultClient(): CorrectionClient | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("Correct: ANTHROPIC_API_KEY not set; cannot apply correction. Parking.");
    return null;
  }
  return new Anthropic({ apiKey });
}

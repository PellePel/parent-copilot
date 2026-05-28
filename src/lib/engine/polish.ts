/**
 * Claude prose-rewrite step.
 *
 * Sits between candidate generation (outgrowing/developmental/absence engines)
 * and the assembler. Takes the engine-templated text and rewrites it into a
 * more conversational voice — like a knowledgeable parent friend, not a
 * textbook.
 *
 * What gets rewritten: headline, body, suggestedAction.
 * What stays untouched: kidId, triggerSource, triggerDetail, reasoning,
 * confidence, rawScore. Reasoning especially — it drives the markdown
 * <details> block and must remain auditable.
 *
 * Discipline (R2): the system prompt forbids adding facts, changing numbers,
 * or removing safety-critical instructions. Polish is voice, not content. If
 * the rewrite would drop a "consult your pediatrician" or "confirm against
 * the seat's manual," it must be preserved verbatim.
 *
 * Failure modes:
 *   - No ANTHROPIC_API_KEY → log warning, return candidates unchanged.
 *   - API call fails → log warning, return candidates unchanged.
 *   - Response fails schema validation → log warning, return candidates unchanged.
 *   - Response missing an id or returning extra ids → log warning, return
 *     candidates unchanged for safety (don't half-apply).
 *
 * Prompt caching: the system prompt has cache_control set so back-to-back
 * runs (e.g. iterating during dev) get a cached input. Real weekly briefs
 * won't hit cache, but it costs nothing to enable.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Candidate } from "./types.js";

const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 4096;

const SYSTEM_PROMPT = `You are the writer for Nick's weekly parenting brief — a Sunday-morning email he reads in two minutes before the kids wake up. Nick has two kids (Clem ~2.5y, Jude ~6mo). His wife Mika currently carries most of the family's mental load; the whole point of this brief is to help Nick anticipate things he'd otherwise miss, so he can step in proactively without Mika having to surface them to him.

You take engine-generated items and rewrite them so they read like one knowledgeable friend talking to another — specifically a friend who has read the medical literature. Warm but direct. The reader is a competent parent, not a beginner.

Voice:
- Warm but direct. Like a thoughtful friend who has read the medical literature.
- Conversational. Contractions are fine.
- Concrete, not abstract. Active voice. Cite facts; don't generalize.
- Second person to Nick — say "you," not "I." Copilot doesn't speak in first person.
- No corporate phrasing ("kindly note," "please be advised").
- No lecturing. No filler. No medical disclaimers UNLESS the item is genuinely safety-relevant (fever thresholds, carseat limits, allergen reactions).
- No emoji.
- Cut hedging only when the original engine text is over-using it. Keep enough hedge to be honest about uncertainty.

Constraints (R2 — preserving trust):
- PRESERVE every fact, number, date, age, vaccine name, weight, week count, percentile, and citation verbatim. If you don't see a fact in the original, do NOT invent it.
- PRESERVE safety-critical instructions verbatim — "consult the pediatrician," "confirm against the seat's manual," "weight AND height limits," "expiration date." These are content, not style.
- PRESERVE meaning. "May be entering" doesn't become "is in." "Appears overdue" doesn't become "is overdue."
- Don't change the suggested action's substance. Polish the words; don't replace the recommendation.

Current edges:
- Some items include a \`related_to_current_edge\` field naming what the relevant kid is actively working on (e.g. "Solid food introduction," "Potty training"). When this is set, you may briefly acknowledge the connection in the body if it helps the item land — e.g. "Since you're already working on solid food intro …" — but don't force it. Skip the framing if it would feel tacked on.

Length targets:
- Headline: under 80 characters.
- Body: under 80 words, preferably 40-60.
- Suggested action: under 35 words.

You'll receive a JSON array of items. Return a JSON array via the submit_rewrites tool with the same length and the same ids. Every item's headline and body are required; suggested_action is omitted if the original had none.`;

const RewriteItem = z.object({
  id: z.string(),
  headline: z.string().min(1),
  body: z.string().min(1),
  suggested_action: z.string().optional(),
});

const RewritesPayload = z.object({
  items: z.array(RewriteItem),
});

const TOOL_DEFINITION = {
  name: "submit_rewrites",
  description: "Submit the rewritten items.",
  input_schema: {
    type: "object" as const,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Same id as the input item." },
            headline: { type: "string", description: "Rewritten headline, under 80 chars." },
            body: { type: "string", description: "Rewritten body, under 80 words." },
            suggested_action: {
              type: "string",
              description: "Rewritten suggested action, under 35 words. Omit if input had none.",
            },
          },
          required: ["id", "headline", "body"],
        },
      },
    },
    required: ["items"],
  },
};

type PolishOptions = {
  /** Override the API key (testing). */
  apiKey?: string;
  /** Override the model. */
  model?: string;
  /**
   * Mutable usage accumulator. If supplied, the function adds input/output
   * tokens for any Claude calls it makes. Captured even when downstream
   * validation fails — tokens were already spent.
   */
  usage?: { input_tokens: number; output_tokens: number };
};

export async function polishCandidates(
  candidates: Candidate[],
  options: PolishOptions = {},
): Promise<Candidate[]> {
  if (candidates.length === 0) return candidates;

  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn(
      "Polish: ANTHROPIC_API_KEY not set; skipping Claude rewrite. Items will use engine-templated text.",
    );
    return candidates;
  }

  // Assign stable ids for the round-trip. Index-based is fine since we control
  // both ends of the call.
  const input = candidates.map((c, i) => ({
    id: String(i),
    headline: c.headline,
    body: c.body,
    suggested_action: c.suggestedAction,
    trigger_detail: c.triggerDetail,
    related_to_current_edge: c.relatedToCurrentEdge ?? null,
  }));

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
            "Here are this week's brief items as JSON. Rewrite each and submit via the submit_rewrites tool.\n\n" +
            JSON.stringify({ items: input }, null, 2),
        },
      ],
    });
    if (options.usage) {
      options.usage.input_tokens += response.usage.input_tokens;
      options.usage.output_tokens += response.usage.output_tokens;
    }
    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      console.warn("Polish: model didn't return a tool_use block. Using engine-templated text.");
      return candidates;
    }
    toolInput = toolBlock.input;
  } catch (err) {
    console.warn(
      `Polish: Anthropic API call failed (${err instanceof Error ? err.message : String(err)}). Using engine-templated text.`,
    );
    return candidates;
  }

  const parsed = RewritesPayload.safeParse(toolInput);
  if (!parsed.success) {
    console.warn(
      `Polish: tool response failed schema validation (${parsed.error.issues[0]?.message}). Using engine-templated text.`,
    );
    return candidates;
  }

  // Round-trip integrity: every input id must appear exactly once.
  const inputIds = new Set(input.map((i) => i.id));
  const outputIds = parsed.data.items.map((i) => i.id);
  const outputIdSet = new Set(outputIds);
  if (outputIds.length !== inputIds.size || outputIdSet.size !== outputIds.length) {
    console.warn(
      `Polish: id mismatch (input=${inputIds.size}, output=${outputIds.length}, unique=${outputIdSet.size}). Using engine-templated text.`,
    );
    return candidates;
  }
  for (const id of outputIds) {
    if (!inputIds.has(id)) {
      console.warn(`Polish: unexpected id "${id}" in response. Using engine-templated text.`);
      return candidates;
    }
  }

  const byId = new Map(parsed.data.items.map((i) => [i.id, i]));
  return candidates.map((c, i) => {
    const rewrite = byId.get(String(i));
    if (!rewrite) return c;
    return {
      ...c,
      headline: rewrite.headline,
      body: rewrite.body,
      // Drop suggested action if Claude omitted it AND the original had none.
      // If the original had one and Claude omitted it, keep the original
      // (preserves safety-critical instructions).
      suggestedAction: rewrite.suggested_action ?? c.suggestedAction,
    };
  });
}

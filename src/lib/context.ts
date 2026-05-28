/**
 * Family context layer (v2.1 spec).
 *
 * Reads `data/family_context.json` — a single rich JSON document holding each
 * kid's developmental milestones, medical history, gear, patterns, current
 * edges, and explicit suppression lists. This is the source of truth for
 * narrative / qualitative state. The SQLite database remains the source for
 * append-only events and brief persistence.
 *
 * Schema discipline (spec): "loose-inside, strict-outside." Validate that the
 * top-level structure exists (family, kids[]) and each kid has the basics
 * (id, name, dob). Treat everything inside a kid as a loose `Record<string,
 * unknown>` so the schema can grow without code changes. Typed accessors
 * provide narrow views for the engines that use them; missing fields return
 * sensible empty defaults rather than throwing.
 */

import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ageInMonths, formatAge, todayIso } from "./age.js";

const DEFAULT_PATH = "./data/family_context.json";

// =============================================================================
// Loose-inside Zod schema — strict only on what the engine assumes exists
// =============================================================================

const FlexibleObject = z.record(z.string(), z.unknown());

const KidSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "kid.dob must be YYYY-MM-DD"),
    sex: z.string().optional(),
  })
  .catchall(z.unknown()); // accept unknown extra fields

const FamilyContextSchema = z
  .object({
    schema_version: z.string().optional(),
    last_updated: z.string().optional(),
    family: FlexibleObject.optional(),
    kids: z.array(KidSchema).min(1, "context must have at least one kid"),
    history: z.unknown().optional(),
  })
  .catchall(z.unknown());

export type FamilyContext = z.infer<typeof FamilyContextSchema>;
export type Kid = z.infer<typeof KidSchema>;

// =============================================================================
// Loader
// =============================================================================

export class ContextNotFoundError extends Error {
  constructor(path: string) {
    super(`family_context.json not found at ${path}. See README "Family context".`);
    this.name = "ContextNotFoundError";
  }
}

export class ContextParseError extends Error {
  constructor(message: string, public readonly path: string) {
    super(`Failed to parse ${path}: ${message}`);
    this.name = "ContextParseError";
  }
}

export type LoadResult =
  | { status: "ok"; context: FamilyContext; path: string; sha256: string }
  | { status: "not_found"; path: string }
  | { status: "parse_error"; path: string; reason: string };

/**
 * Load and validate the family context. Returns a typed status response so
 * callers can degrade gracefully when the file is missing or malformed. The
 * `sha256` field on `ok` results uniquely identifies the loaded version —
 * used in per-brief logs so we can correlate a brief with the context state
 * at the time it was generated.
 */
export function loadFamilyContext(path: string = DEFAULT_PATH): LoadResult {
  if (!existsSync(path)) {
    return { status: "not_found", path };
  }
  let rawText: string;
  try {
    rawText = readFileSync(path, "utf8");
  } catch (err) {
    return {
      status: "parse_error",
      path,
      reason: `read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch (err) {
    return {
      status: "parse_error",
      path,
      reason: `not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const parsed = FamilyContextSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "parse_error",
      path,
      reason: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }
  const sha256 = createHash("sha256").update(rawText).digest("hex");
  return { status: "ok", context: parsed.data, path, sha256 };
}

// =============================================================================
// Typed accessors — pull out exactly what engines need, with empty defaults
// =============================================================================

export function getKid(context: FamilyContext, id: string): Kid | null {
  return context.kids.find((k) => k.id === id) ?? null;
}

export function getKidByName(context: FamilyContext, name: string): Kid | null {
  const target = name.toLowerCase();
  return (
    context.kids.find(
      (k) => k.name.toLowerCase() === target || k.name.toLowerCase().startsWith(`${target} `),
    ) ?? null
  );
}

export function getKidAgeMonths(kid: Kid, asOf: string = todayIso()): number {
  return ageInMonths(kid.dob, asOf);
}

export function getKidAgeString(kid: Kid, asOf: string = todayIso()): string {
  return formatAge(kid.dob, asOf);
}

/**
 * Suppression list per kid — entries in `developmental.things_we_already_know`.
 * Used by the rule engine (belt) and the LLM prompt (suspenders).
 * Returns empty list when missing.
 */
export function getKidSuppressions(kid: Kid): string[] {
  const dev = kid["developmental"];
  if (!isObject(dev)) return [];
  const list = (dev as Record<string, unknown>)["things_we_already_know"];
  if (!Array.isArray(list)) return [];
  return list.filter((s): s is string => typeof s === "string");
}

/**
 * Current edges per kid — entries in `developmental.current_edges`. These
 * represent what the kid is actively working on. Signals related to these
 * should be priority-boosted, not suppressed.
 */
export function getKidCurrentEdges(kid: Kid): string[] {
  const dev = kid["developmental"];
  if (!isObject(dev)) return [];
  const list = (dev as Record<string, unknown>)["current_edges"];
  if (!Array.isArray(list)) return [];
  return list.filter((s): s is string => typeof s === "string");
}

export type ContextMilestone = {
  milestone: string;
  status: string;
  observed_date?: string | null;
  notes?: string | null;
  confidence?: string | null;
  source?: string | null;
};

export function getKidMilestones(kid: Kid): ContextMilestone[] {
  const dev = kid["developmental"];
  if (!isObject(dev)) return [];
  const list = (dev as Record<string, unknown>)["milestones"];
  if (!Array.isArray(list)) return [];
  return list.filter(isMilestone);
}

export type ContextMedication = {
  name: string;
  started?: string;
  status?: string;
  instructions?: string;
  context?: string;
};

/**
 * Medications listed under context.medical.medications. The medication
 * follow-up engine uses these to flag entries with TBD/missing status that
 * haven't been confirmed in 30+ days (e.g. "is Jude still on the saline
 * neb?"). Missing entries return an empty list.
 */
export function getKidMedications(kid: Kid): ContextMedication[] {
  const medical = (kid as Record<string, unknown>)["medical"];
  if (!isObject(medical)) return [];
  const list = (medical as Record<string, unknown>)["medications"];
  if (!Array.isArray(list)) return [];
  return list.filter(isMedication);
}

function isMedication(v: unknown): v is ContextMedication {
  if (!isObject(v)) return false;
  if (typeof v["name"] !== "string") return false;
  return true;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isMilestone(v: unknown): v is ContextMilestone {
  if (!isObject(v)) return false;
  return typeof v["milestone"] === "string" && typeof v["status"] === "string";
}

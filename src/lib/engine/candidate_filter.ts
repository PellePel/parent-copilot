/**
 * U6 — Suppression + quarantine filter pass.
 *
 * A single chokepoint that runs over fully-collected, edge-annotated candidates
 * right before the assembler. Two independent reasons drop a candidate:
 *
 *   1. QUARANTINE — the candidate cites a spine record that is actively
 *      quarantined (a "wrong"-flagged fact whose correction hasn't landed).
 *      We never re-fire anything reasoned off a record under quarantine.
 *
 *   2. SUPPRESSION — an active `suppressions` row matches the candidate's
 *      (kidSpineId, triggerDetail). Suppressions are never a permanent mute:
 *      each carries a `revalidationKind` that we re-evaluate at generation
 *      time. The item resurfaces only once its condition has genuinely lapsed.
 *
 * Read-only, like the engines: it queries SQLite (suppressions, quarantines,
 * measurements) and reads the spine via `loadFamilyContext` for milestone
 * status. No writes.
 *
 * Coexists with — does not replace — the time-window suppression (`firedInLast`)
 * and context suppression (`things_we_already_know`) that run inside the
 * engines. This pass is additive.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  kids as kidsTable,
  measurements,
  quarantines,
  suppressions,
  type Suppression,
} from "../db/schema.js";
import {
  getKid,
  getKidMilestones,
  loadFamilyContext,
  type FamilyContext,
} from "../context.js";
import type { Candidate } from "./types.js";

type FilterOptions = {
  asOf: string;
  /** Spine path override for tests; defaults to data/family_context.json. */
  contextPath?: string;
};

// =============================================================================
// Quarantine
// =============================================================================

/** Active quarantine record-paths for a kid. Empty set when none / no kid. */
function activeQuarantinePaths(kidSpineId: string): Set<string> {
  if (!kidSpineId) return new Set();
  const rows = db
    .select({ recordPath: quarantines.recordPath })
    .from(quarantines)
    .where(and(eq(quarantines.kidSpineId, kidSpineId), eq(quarantines.active, true)))
    .all();
  return new Set(rows.map((r) => r.recordPath));
}

// =============================================================================
// Suppression
// =============================================================================

function activeSuppression(kidSpineId: string, triggerDetail: string): Suppression | null {
  if (!kidSpineId) return null;
  return (
    db
      .select()
      .from(suppressions)
      .where(
        and(
          eq(suppressions.kidSpineId, kidSpineId),
          eq(suppressions.triggerDetail, triggerDetail),
        ),
      )
      .get() ?? null
  );
}

/** Map a kid spine id to its DB integer id (for measurement queries). */
function dbKidIdForSpine(kidSpineId: string): number | null {
  if (!kidSpineId) return null;
  const row = db
    .select({ id: kidsTable.id })
    .from(kidsTable)
    .where(eq(kidsTable.spineId, kidSpineId))
    .get();
  return row?.id ?? null;
}

/**
 * Decide whether an active suppression should still hold (DROP the candidate)
 * given its re-validation kind. Returns true = STILL SUPPRESSED (drop).
 */
function suppressionStillHolds(
  s: Suppression,
  candidate: Candidate,
  opts: FilterOptions,
  ctx: FamilyContext | null,
): boolean {
  const params = (s.revalidationParams ?? {}) as Record<string, unknown>;
  switch (s.revalidationKind) {
    case "forever":
      // Stays suppressed until the record changes / an explicit un-suppress.
      return true;

    case "until_date": {
      // Suppressed until the stored date passes. DROP while asOf < date.
      const date = typeof params["date"] === "string" ? (params["date"] as string) : null;
      if (!date) return true; // malformed → safest is to stay suppressed
      return opts.asOf < date;
    }

    case "until_milestone_change": {
      // Read the milestone status from the spine. The item is relevant again
      // (KEEP) only if the milestone is "no longer cleared" — i.e. it regressed
      // from whatever cleared-ish status was stored. V1: treat any
      // cleared/ongoing/emerging status as STILL HOLDING (drop).
      const milestoneId =
        typeof params["milestoneId"] === "string" ? (params["milestoneId"] as string) : null;
      const kidSpineId = candidate.citedRecord.kidSpineId;
      const kid = ctx && kidSpineId ? getKid(ctx, kidSpineId) : null;
      if (!kid || !milestoneId) return true; // can't read → stay suppressed
      const milestone = getKidMilestones(kid).find((m) => m.milestone === milestoneId);
      if (!milestone) return false; // milestone gone → no longer cleared → KEEP
      return isClearedish(milestone.status);
    }

    case "measurement_band": {
      // Suppressed until a NEWER measurement crosses the recorded band. If
      // there's no measurement at all for the dimension, the condition is
      // treated as STILL HOLDING — resurfacing requires a concrete reading.
      return measurementBandStillHolds(candidate, params);
    }

    default:
      // Unknown kind → conservative: stay suppressed.
      return true;
  }
}

/**
 * A milestone status that suppresses "you're entering this window" items.
 * Mirrors the developmental engine's belt (cleared/ongoing/emerging).
 */
function isClearedish(status: string): boolean {
  const s = status.toLowerCase();
  return s === "cleared" || s === "ongoing" || s === "emerging";
}

/**
 * measurement_band re-validation. revalidationParams shape:
 *   { type: MeasurementType, value: number, measuredOn: ISODate }
 * captured at suppression time (the band the item fired at). The condition
 * lapses — KEEP — once a NEWER measurement of that type has crossed the band:
 * a row with `measuredOn` strictly after the stored date AND a `value` past
 * the recorded threshold. No qualifying measurement (including none at all)
 * means the band still holds → DROP.
 */
function measurementBandStillHolds(
  candidate: Candidate,
  params: Record<string, unknown>,
): boolean {
  const type = typeof params["type"] === "string" ? (params["type"] as string) : null;
  const bandValue = typeof params["value"] === "number" ? (params["value"] as number) : null;
  const bandDate =
    typeof params["measuredOn"] === "string" ? (params["measuredOn"] as string) : null;
  if (!type || bandValue === null) return true; // malformed → stay suppressed

  const kidId = candidate.kidId ?? dbKidIdForSpine(candidate.citedRecord.kidSpineId);
  if (kidId === null) return true; // can't resolve the kid → stay suppressed

  const rows = db
    .select({ value: measurements.value, measuredOn: measurements.measuredOn })
    .from(measurements)
    .where(and(eq(measurements.kidId, kidId), eq(measurements.type, type as never)))
    .all();

  // CRUCIAL: no measurement at all for this dimension → condition still holds.
  if (rows.length === 0) return true;

  const crossed = rows.some(
    (m) => (bandDate ? m.measuredOn > bandDate : true) && m.value > bandValue,
  );
  // Crossed → condition lapsed → KEEP (does NOT still hold).
  return !crossed;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Drop candidates that are actively suppressed (re-validated) or cite a
 * quarantined record. Returns the kept candidates in their original order.
 */
export function filterCandidates(candidates: Candidate[], opts: FilterOptions): Candidate[] {
  // Load the spine once (for milestone re-validation). Degrade gracefully:
  // if it can't load, milestone suppressions conservatively stay suppressed.
  const ctxResult = loadFamilyContext(opts.contextPath);
  const ctx = ctxResult.status === "ok" ? ctxResult.context : null;

  // Cache active quarantine paths per kid spine id (one query per distinct kid).
  const quarantineCache = new Map<string, Set<string>>();
  const quarantinePaths = (kidSpineId: string): Set<string> => {
    let cached = quarantineCache.get(kidSpineId);
    if (!cached) {
      cached = activeQuarantinePaths(kidSpineId);
      quarantineCache.set(kidSpineId, cached);
    }
    return cached;
  };

  return candidates.filter((c) => {
    const { kidSpineId, path } = c.citedRecord;

    // 1. Quarantine: cited record under active quarantine → DROP.
    if (kidSpineId && quarantinePaths(kidSpineId).has(path)) return false;

    // 2. Suppression: an active row for (kidSpineId, triggerDetail) → evaluate.
    const supp = activeSuppression(kidSpineId, c.triggerDetail);
    if (supp && suppressionStillHolds(supp, c, opts, ctx)) return false;

    return true;
  });
}

// =============================================================================
// Cross-products redaction
// =============================================================================

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

type Segment = { kind: "key"; key: string } | { kind: "index"; index: number };

/** Parse dot/bracket notation into ordered segments. */
function parsePath(path: string): Segment[] {
  const segments: Segment[] = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path)) !== null) {
    if (match[1] !== undefined) segments.push({ kind: "key", key: match[1] });
    else if (match[2] !== undefined) segments.push({ kind: "index", index: Number(match[2]) });
  }
  return segments;
}

/** Blank the value at a dot/bracket path on a kid object (best-effort, no throw). */
function blankAtPath(kid: Json, path: string): void {
  const segments = parsePath(path);
  if (segments.length === 0) return;
  let cursor: unknown = kid;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (seg.kind === "key") {
      if (!isObject(cursor)) return;
      cursor = cursor[seg.key];
    } else {
      if (!Array.isArray(cursor)) return;
      cursor = cursor[seg.index];
    }
  }
  const last = segments[segments.length - 1]!;
  if (last.kind === "key") {
    if (!isObject(cursor)) return;
    if (!(last.key in cursor)) return;
    cursor[last.key] = "[redacted: under correction]";
  } else {
    if (!Array.isArray(cursor)) return;
    if (last.index >= cursor.length) return;
    cursor[last.index] = "[redacted: under correction]";
  }
}

/**
 * Redact actively-quarantined subtrees from a cross-products context payload so
 * the LLM cannot reason off a "wrong"-flagged fact. Operates on a DEEP COPY —
 * the passed object (and the real spine) are never mutated. The payload is the
 * `buildContextPayload` output: `{ family, kids: [...], history }`, where each
 * kid carries its string `id`. We look up active quarantines per kid id and
 * blank each quarantined record path.
 */
export function redactQuarantined<T>(contextObject: T): T {
  const copy = structuredClone(contextObject) as unknown;
  if (!isObject(copy)) return copy as T;
  const kids = copy["kids"];
  if (!Array.isArray(kids)) return copy as T;

  for (const kid of kids) {
    if (!isObject(kid)) continue;
    const kidSpineId = typeof kid["id"] === "string" ? (kid["id"] as string) : "";
    if (!kidSpineId) continue;
    const paths = activeQuarantinePaths(kidSpineId);
    for (const path of paths) blankAtPath(kid, path);
  }
  return copy as T;
}

/**
 * U2 — Spine mutator + quarantine helpers.
 *
 * The FIRST writer to `data/family_context.json`. `context.ts` is read-only;
 * this module performs locked, atomic read-modify-write (RMW) mutations on the
 * spine plus DB-backed quarantine bookkeeping.
 *
 * Discipline:
 *   - "Loose-inside, strict-outside" must survive writes. We re-read and mutate
 *     the FULL RAW parsed JSON (not the Zod-narrowed `loadFamilyContext` view),
 *     so unknown/extra fields are preserved byte-for-byte everywhere we don't
 *     touch.
 *   - Every mutation: lock the file, re-read raw JSON, mutate, stamp
 *     `last_updated`, serialize with 2-space indent, validate the candidate via
 *     `loadFamilyContext` (must be "ok"), then atomically `rename` over the
 *     original. On any validation failure the temp file is deleted and the
 *     original is left untouched.
 *   - Optimistic-concurrency backstop: the sha256 captured at read is
 *     re-checked just before rename; if the file changed underneath us, we
 *     release the lock and retry the whole RMW (bounded retries).
 *
 * Mutators are keyed by the kid spine id (`kids[].id`), and the file path is
 * injectable (`contextPath`) so tests can point at a temp copy.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { and, eq } from "drizzle-orm";

import { loadFamilyContext } from "./context.js";
import { todayIso } from "./age.js";
import { db } from "./db/index.js";
import { quarantines, type Quarantine } from "./db/schema.js";

const DEFAULT_PATH = "./data/family_context.json";
const MAX_RMW_RETRIES = 3;

type Json = Record<string, unknown>;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Locate the kid record (raw, mutable) within the parsed spine, or throw. */
function findKid(root: Json, kidSpineId: string): Json {
  const kids = root["kids"];
  if (!Array.isArray(kids)) {
    throw new Error(`spine has no kids[] array (path=${kidSpineId})`);
  }
  const kid = kids.find((k) => isObject(k) && k["id"] === kidSpineId);
  if (!isObject(kid)) {
    throw new Error(`no kid with id="${kidSpineId}" in spine`);
  }
  return kid;
}

/** Get-or-create a nested object at `obj[key]`. */
function ensureObject(obj: Json, key: string): Json {
  const existing = obj[key];
  if (isObject(existing)) return existing;
  const created: Json = {};
  obj[key] = created;
  return created;
}

/** Get-or-create a string[] at `obj[key]`. */
function ensureStringArray(obj: Json, key: string): string[] {
  const existing = obj[key];
  if (Array.isArray(existing)) return existing as string[];
  const created: string[] = [];
  obj[key] = created;
  return created;
}

/**
 * Stamp `last_updated` to today on the root and, if a section object carries
 * its own `last_updated`, on that section too.
 */
function stampUpdated(root: Json, section?: Json): void {
  const today = todayIso();
  root["last_updated"] = today;
  if (section && "last_updated" in section) {
    section["last_updated"] = today;
  }
}

/**
 * Core locked + atomic read-modify-write. The mutator receives the full raw
 * parsed spine and the located kid record, mutates them in place, and may
 * return a "section" object whose own `last_updated` should be stamped.
 */
export async function mutateSpine(
  kidSpineId: string,
  contextPath: string,
  mutate: (root: Json, kid: Json) => Json | void,
): Promise<void> {
  if (!existsSync(contextPath)) {
    throw new Error(`family_context.json not found at ${contextPath}`);
  }

  for (let attempt = 0; attempt < MAX_RMW_RETRIES; attempt++) {
    const release = await lockfile.lock(contextPath, {
      retries: { retries: 10, minTimeout: 20, maxTimeout: 200 },
      stale: 10_000,
    });
    try {
      const rawText = readFileSync(contextPath, "utf8");
      const readSha = sha256(rawText);
      const root = JSON.parse(rawText) as Json;
      if (!isObject(root)) {
        throw new Error(`${contextPath} is not a JSON object`);
      }

      const kid = findKid(root, kidSpineId);
      const section = mutate(root, kid);
      stampUpdated(root, section ?? undefined);

      const serialized = JSON.stringify(root, null, 2);

      // Optimistic-concurrency backstop: bail to a retry if the file changed
      // under us between our read and now.
      const currentText = readFileSync(contextPath, "utf8");
      if (sha256(currentText) !== readSha) {
        await release();
        continue; // retry the whole RMW
      }

      // Write to a temp file in the same dir, validate it re-parses cleanly,
      // then atomically rename over the original.
      const tempPath = join(dirname(contextPath), `.family_context.${process.pid}.${Date.now()}.tmp`);
      writeFileSync(tempPath, serialized, "utf8");
      const validated = loadFamilyContext(tempPath);
      if (validated.status !== "ok") {
        try {
          unlinkSync(tempPath);
        } catch {
          /* best-effort cleanup */
        }
        const reason = validated.status === "parse_error" ? validated.reason : validated.status;
        throw new Error(`refusing to write invalid spine: ${reason}`);
      }
      renameSync(tempPath, contextPath);
      await release();
      return;
    } catch (err) {
      await release();
      throw err;
    }
  }
  throw new Error(
    `mutateSpine: gave up after ${MAX_RMW_RETRIES} retries (concurrent writes to ${contextPath})`,
  );
}

// =============================================================================
// Deterministic mutators
// =============================================================================

/**
 * Move `allergen` from `patterns.eating.allergen_introduction_status.not_yet_introduced`
 * to `introduced`. Idempotent: no duplicate, no-op if already introduced.
 */
export async function markAllergenIntroduced(
  kidSpineId: string,
  allergen: string,
  contextPath: string = DEFAULT_PATH,
): Promise<void> {
  await mutateSpine(kidSpineId, contextPath, (_root, kid) => {
    const patterns = ensureObject(kid, "patterns");
    const eating = ensureObject(patterns, "eating");
    const status = ensureObject(eating, "allergen_introduction_status");
    const introduced = ensureStringArray(status, "introduced");
    const notYet = ensureStringArray(status, "not_yet_introduced");

    status["not_yet_introduced"] = notYet.filter((a) => a !== allergen);
    if (!introduced.includes(allergen)) introduced.push(allergen);
    return eating;
  });
}

/**
 * Set the matching `developmental.milestones[].status` to "cleared" (matched by
 * the `milestone` id field).
 */
export async function clearMilestone(
  kidSpineId: string,
  milestoneId: string,
  contextPath: string = DEFAULT_PATH,
): Promise<void> {
  await mutateSpine(kidSpineId, contextPath, (_root, kid) => {
    const dev = ensureObject(kid, "developmental");
    const milestones = dev["milestones"];
    const match = Array.isArray(milestones)
      ? milestones.find((m) => isObject(m) && m["milestone"] === milestoneId)
      : undefined;
    if (isObject(match)) {
      // Milestone already recorded — mark it cleared.
      match["status"] = "cleared";
    } else {
      // Window fired before any milestone row exists (the common "entering the
      // window" case). Record it as known so the developmental engine's
      // context suppression stops surfacing it — don't fail the reaction.
      const known = ensureStringArray(dev, "things_we_already_know");
      if (!known.includes(milestoneId)) known.push(milestoneId);
    }
    return dev;
  });
}

/**
 * Append `entry` to `developmental.things_we_already_know`. Idempotent — no
 * duplicate.
 */
export async function addThingWeAlreadyKnow(
  kidSpineId: string,
  entry: string,
  contextPath: string = DEFAULT_PATH,
): Promise<void> {
  await mutateSpine(kidSpineId, contextPath, (_root, kid) => {
    const dev = ensureObject(kid, "developmental");
    const list = ensureStringArray(dev, "things_we_already_know");
    if (!list.includes(entry)) list.push(entry);
    return dev;
  });
}

/**
 * Write the next-well-visit-due marker.
 *
 * PATH RECONCILIATION: the absence engine (`engine/absence.ts`) reads
 * `medical.next_well_visit.date` (an object with a `date` field). The example
 * file previously stored `medical.next_well_visit_due` (a scalar). We adopt the
 * absence engine's read path as canonical — `medical.next_well_visit.date` —
 * and write there, so a scheduled visit actually suppresses the re-firing item.
 * The example file is updated to match.
 */
export async function advanceWellVisitDue(
  kidSpineId: string,
  nextDueDate: string,
  contextPath: string = DEFAULT_PATH,
): Promise<void> {
  await mutateSpine(kidSpineId, contextPath, (_root, kid) => {
    const medical = ensureObject(kid, "medical");
    const next = ensureObject(medical, "next_well_visit");
    next["date"] = nextDueDate;
    return medical;
  });
}

/**
 * LLM correction path ONLY. Set `value` at `path` (dot/bracket notation),
 * asserting the path resolves WITHIN `kids[id=kidSpineId]`'s subtree. Rejects
 * (throws) if the path escapes that subtree (another kid, a root key,
 * `family.*`, etc.).
 *
 * `path` is relative to the kid record, e.g. `medical.allergies[0]` or
 * `patterns.eating.schedule`. A leading `kids[...]` segment that targets a
 * different kid is rejected.
 */
export async function applySpineDiff(
  kidSpineId: string,
  path: string,
  value: unknown,
  contextPath: string = DEFAULT_PATH,
): Promise<void> {
  const segments = parsePath(path);
  assertWithinKidSubtree(segments, kidSpineId);

  await mutateSpine(kidSpineId, contextPath, (_root, kid) => {
    setAtPath(kid, segments, value);
    return undefined;
  });
}

type Segment = { kind: "key"; key: string } | { kind: "index"; index: number };

// Prototype-pollution guard: a correction path must never name these keys, or a
// hallucinated/malicious path like "__proto__.isAdmin" would walk into and
// mutate Object.prototype via setAtPath.
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Parse dot/bracket notation into ordered segments. */
function parsePath(path: string): Segment[] {
  const segments: Segment[] = [];
  // Split on dots that aren't inside brackets, then expand bracket indices.
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = re.exec(path)) !== null) {
    consumed = re.lastIndex;
    if (match[1] !== undefined) {
      if (FORBIDDEN_KEYS.has(match[1])) {
        throw new Error(`applySpineDiff: forbidden path segment "${match[1]}" (prototype pollution)`);
      }
      segments.push({ kind: "key", key: match[1] });
    } else if (match[2] !== undefined) {
      segments.push({ kind: "index", index: Number(match[2]) });
    }
  }
  if (segments.length === 0 || consumed !== path.length) {
    // consumed check is best-effort; reject obviously-empty paths.
    if (segments.length === 0) throw new Error(`applySpineDiff: empty/unparseable path "${path}"`);
  }
  return segments;
}

/**
 * Reject any path that escapes the kid's subtree. A bare relative path (first
 * segment is a key other than a root-escaping one) is fine. If the path starts
 * with `kids[...]`, the targeted index/id must resolve to THIS kid; targeting
 * `family`, `history`, `schema_version`, etc. at the root is rejected.
 */
function assertWithinKidSubtree(segments: Segment[], kidSpineId: string): void {
  const first = segments[0];
  if (!first) throw new Error("applySpineDiff: empty path");

  // Root-key escapes: a path beginning with a known root key (other than into
  // this kid via kids[...]) is not within the kid subtree.
  if (first.kind === "key") {
    const rootEscapeKeys = new Set(["family", "history", "schema_version", "last_updated", "kids"]);
    if (first.key === "kids") {
      // Must be kids[<index|...>] ... but we cannot resolve a numeric index to
      // a kid id without the data. The safe, unambiguous contract: only allow
      // an explicit `kids` prefix when it is immediately followed by an id
      // match expressed as kids.<id> — otherwise reject. Since dot/bracket
      // notation can't carry an id predicate, we reject all `kids`-prefixed
      // paths and require callers to pass kid-relative paths.
      throw new Error(
        `applySpineDiff: path must be relative to the kid (no "kids[...]" prefix); got "${first.key}..."`,
      );
    }
    if (rootEscapeKeys.has(first.key)) {
      throw new Error(`applySpineDiff: path escapes kid "${kidSpineId}" subtree (root key "${first.key}")`);
    }
    return; // kid-relative key — within subtree
  }
  // First segment is an array index with no key — meaningless on a kid object.
  throw new Error(`applySpineDiff: path cannot begin with an array index`);
}

/** Set `value` at the segment path, creating intermediate containers. */
function setAtPath(root: Json, segments: Segment[], value: unknown): void {
  // Defense-in-depth: reject forbidden keys here too, so any caller that walks a
  // path to SET (not just applySpineDiff's parsePath) can't pollute the prototype.
  for (const seg of segments) {
    if (seg.kind === "key" && FORBIDDEN_KEYS.has(seg.key)) {
      throw new Error(`setAtPath: forbidden path segment "${seg.key}" (prototype pollution)`);
    }
  }
  let cursor: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const next = segments[i + 1]!;
    if (seg.kind === "key") {
      if (!isObject(cursor)) throw new Error(`applySpineDiff: cannot descend key "${seg.key}" into non-object`);
      let child = cursor[seg.key];
      if (child === undefined || child === null) {
        child = next.kind === "index" ? [] : {};
        cursor[seg.key] = child;
      }
      cursor = child;
    } else {
      if (!Array.isArray(cursor)) throw new Error(`applySpineDiff: cannot index [${seg.index}] into non-array`);
      let child = cursor[seg.index];
      if (child === undefined || child === null) {
        child = next.kind === "index" ? [] : {};
        cursor[seg.index] = child;
      }
      cursor = child;
    }
  }
  const last = segments[segments.length - 1]!;
  if (last.kind === "key") {
    if (!isObject(cursor)) throw new Error(`applySpineDiff: cannot set key "${last.key}" on non-object`);
    cursor[last.key] = value;
  } else {
    if (!Array.isArray(cursor)) throw new Error(`applySpineDiff: cannot set index [${last.index}] on non-array`);
    cursor[last.index] = value;
  }
}

// =============================================================================
// Quarantine helpers (DB)
// =============================================================================

/**
 * Insert an active quarantine for (kidSpineId, recordPath). Idempotent: if an
 * active row for the same kid+path already exists, this is a no-op.
 */
export function quarantineRecord(kidSpineId: string, recordPath: string, reason?: string): void {
  const existing = db
    .select({ id: quarantines.id })
    .from(quarantines)
    .where(
      and(
        eq(quarantines.kidSpineId, kidSpineId),
        eq(quarantines.recordPath, recordPath),
        eq(quarantines.active, true),
      ),
    )
    .limit(1)
    .get();
  if (existing) return;
  db.insert(quarantines).values({ kidSpineId, recordPath, reason: reason ?? null }).run();
}

/** Lift a quarantine by id: set active=false, liftedAt=now. */
export function liftQuarantine(id: number): void {
  db.update(quarantines)
    .set({ active: false, liftedAt: new Date().toISOString() })
    .where(eq(quarantines.id, id))
    .run();
}

/** Return all active quarantine rows for a kid. */
export function activeQuarantines(kidSpineId: string): Quarantine[] {
  return db
    .select()
    .from(quarantines)
    .where(and(eq(quarantines.kidSpineId, kidSpineId), eq(quarantines.active, true)))
    .all();
}

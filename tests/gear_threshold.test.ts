/**
 * U1 — weight/gear-threshold engine (sleep sack).
 *
 * The engine queries SQLite for weight_kg measurements. The db module opens
 * COPILOT_DB_PATH once at load time and that connection is cached for the whole
 * process (the known singleton gotcha) — so a per-test temp DB does NOT work
 * with repeated dynamic imports. Instead: set the path once, open the schema
 * via a raw handle, import the engine once, and reset/reseed measurements
 * between tests through the same file.
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import type { Kid as DbKid } from "../src/lib/db/schema.js";
import type { Kid as ContextKid } from "../src/lib/context.js";
import { lbToKg } from "../src/lib/kb/gear.js";

const DOB = "2025-12-07"; // Jude — ~5mo at AS_OF, inside the youngest weight band
const AS_OF = "2026-05-10";

// --- One shared temp DB for the whole file (set BEFORE importing the engine) --
const dir = mkdtempSync(join(tmpdir(), "copilot-gear-"));
const dbPath = join(dir, "test.db");
process.env.COPILOT_DB_PATH = dbPath;

const raw = new Database(dbPath);
raw.exec(`
  CREATE TABLE kids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, dob TEXT NOT NULL,
    pediatrician TEXT, daycare TEXT, notes TEXT, spine_id TEXT, created_at TEXT
  );
  CREATE TABLE measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kid_id INTEGER NOT NULL, type TEXT NOT NULL, value REAL NOT NULL,
    unit TEXT NOT NULL, measured_on TEXT NOT NULL, source TEXT, created_at TEXT
  );
`);
raw.prepare("INSERT INTO kids (id, name, dob, spine_id) VALUES (?, ?, ?, ?)").run(1, "Jude Pelletier", DOB, "jude");

// Import the engine once, after COPILOT_DB_PATH is set, so its db connection
// opens the shared temp DB.
const { sleepSackCandidatesFor } = await import("../src/lib/engine/gear_threshold.js");

beforeEach(() => {
  raw.exec("DELETE FROM measurements");
});

function insertWeight(value: number, measuredOn: string): void {
  raw
    .prepare("INSERT INTO measurements (kid_id, type, value, unit, measured_on) VALUES (?, ?, ?, ?, ?)")
    .run(1, "weight_kg", value, "kg", measuredOn);
}

function dbKid(overrides: Partial<DbKid> = {}): DbKid {
  return {
    id: 1,
    name: "Jude Pelletier",
    dob: DOB,
    pediatrician: null,
    daycare: null,
    notes: null,
    spineId: "jude",
    createdAt: "2026-01-01",
    ...overrides,
  } as DbKid;
}

test("sleep_sack: fires when projected weight approaches the size-up threshold", () => {
  insertWeight(7.7, AS_OF); // ~0.45 kg below the Small threshold (≈8.16 kg)
  const out = sleepSackCandidatesFor(dbKid(), undefined, AS_OF);

  assert.equal(out.length, 1, "expected one sleep-sack candidate");
  const c = out[0]!;
  assert.equal(c.triggerDetail, "outgrowing:sleep_sack");
  assert.equal(c.citedRecord.path, "gear.sleep_sack");
  assert.equal(c.citedRecord.kidSpineId, "jude");
  assert.equal(c.factTarget, undefined, "gear engine is suppression-only");
  assert.equal(c.triggerSource, "lookahead");
  assert.match(c.reasoning, /7\.7kg/);
  assert.match(c.reasoning, new RegExp(lbToKg(18).toFixed(2).replace(".", "\\.")));
});

test("sleep_sack: AE2 — observed slope from two readings drives the crossing", () => {
  insertWeight(7.5, "2026-04-26");
  insertWeight(7.86, AS_OF); // ≈0.18 kg/week (~0.4 lb/week), 14 days apart
  const out = sleepSackCandidatesFor(dbKid(), undefined, AS_OF);

  assert.equal(out.length, 1);
  assert.match(out[0]!.reasoning, /observed .* kg\/week/, "should project via the observed slope, not KB median");
});

test("sleep_sack: no weight measurement → no candidate", () => {
  assert.deepEqual(sleepSackCandidatesFor(dbKid(), undefined, AS_OF), []);
});

test("sleep_sack: projection reaches the threshold → size-up-now candidate", () => {
  insertWeight(8.0, "2026-04-12"); // below Small, but projecting 4 weeks crosses ≈8.16 kg
  const out = sleepSackCandidatesFor(dbKid(), undefined, AS_OF);

  assert.equal(out.length, 1);
  const c = out[0]!;
  assert.match(c.headline, /ready to size up/i);
  assert.equal(c.confidence, "high");
  assert.ok(c.rawScore >= 85, "size-up-now should rank high");
});

test("sleep_sack: per-kid spine override takes precedence over the KB default", () => {
  insertWeight(9.0, AS_OF); // above Small default; override says size up at 22 lb (≈9.98 kg)
  const ctx = {
    id: "jude",
    name: "Jude Pelletier",
    dob: DOB,
    gear: { sleep_sack: { size_up_at_lb: 22 } },
  } as unknown as ContextKid;

  const out = sleepSackCandidatesFor(dbKid(), ctx, AS_OF);

  assert.equal(out.length, 1);
  const c = out[0]!;
  assert.match(c.reasoning, /per-kid spine override/);
  assert.match(c.headline, /will outgrow/i); // not yet at 9.98 kg → approaching, not size-up-now
});

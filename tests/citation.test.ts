/**
 * U1b — citation fields on candidates.
 *
 * Every engine must stamp each Candidate with a non-empty `citedRecord`
 * (kidSpineId + path). A few clean deterministic cases also stamp a
 * `factTarget`. These tests use minimal in-memory stubs so they're
 * dependency-free and don't touch the real database — except the outgrowing
 * case, which queries SQLite and therefore runs against a fresh temp DB.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import type { Kid as DbKid } from "../src/lib/db/schema.js";
import type { Kid as ContextKid } from "../src/lib/context.js";
import type { Candidate } from "../src/lib/engine/types.js";

import { allergenWindowCandidatesFor } from "../src/lib/engine/allergen_window.js";
import { developmentalCandidatesFor } from "../src/lib/engine/developmental.js";

// --- Stubs -----------------------------------------------------------------

/** A DB kid row stub — engines only read id/name/dob/spineId. */
function dbKid(overrides: Partial<DbKid> = {}): DbKid {
  return {
    id: 1,
    name: "Jude Pelletier",
    dob: "2025-12-07",
    pediatrician: null,
    daycare: null,
    notes: null,
    spineId: "jude",
    createdAt: "2026-01-01",
    ...overrides,
  } as DbKid;
}

/** A context kid (loose-inside) with an allergen-introduction status. */
function contextKidWithAllergens(): ContextKid {
  return {
    id: "jude",
    name: "Jude Pelletier",
    dob: "2025-12-07",
    patterns: {
      eating: {
        allergen_introduction_status: {
          introduced: [],
          not_yet_introduced: [
            "peanut",
            "tree_nuts",
            "egg",
            "wheat",
            "dairy",
            "soy",
            "fish",
            "shellfish",
            "sesame",
          ],
        },
      },
    },
  } as unknown as ContextKid;
}

function assertHasCitedRecord(c: Candidate): void {
  assert.ok(c.citedRecord, `expected citedRecord on candidate "${c.triggerDetail}"`);
  assert.equal(typeof c.citedRecord.kidSpineId, "string");
  assert.equal(typeof c.citedRecord.path, "string");
  assert.ok(c.citedRecord.path.length > 0, "path must be non-empty");
}

// --- Tests -----------------------------------------------------------------

// asOf = ~5 months after dob (2025-12-07) → inside the allergen window (4-7mo)
// and inside several developmental windows.
const AS_OF = "2026-05-10";

test("allergen_window: candidate carries citedRecord + allergen factTarget", () => {
  const out = allergenWindowCandidatesFor(dbKid(), contextKidWithAllergens(), AS_OF);
  assert.equal(out.length, 1, "expected one allergen candidate");
  const c = out[0]!;
  assertHasCitedRecord(c);
  assert.equal(c.citedRecord.kidSpineId, "jude");
  assert.equal(c.citedRecord.path, "patterns.eating.allergen_introduction_status");
  // Start mode, nothing introduced → primary target is peanut.
  assert.deepEqual(c.factTarget, { kind: "allergen", allergen: "peanut" });
});

test("developmental: candidates carry citedRecord + milestone factTarget", () => {
  const out = developmentalCandidatesFor(dbKid(), AS_OF, {
    contextKid: contextKidWithAllergens(),
  });
  assert.ok(out.length > 0, "expected at least one developmental candidate");
  for (const c of out) {
    assertHasCitedRecord(c);
    assert.equal(c.citedRecord.kidSpineId, "jude");
    assert.match(c.citedRecord.path, /^developmental\.milestones\[/);
    assert.ok(c.factTarget, "developmental candidate must have a factTarget");
    assert.equal(c.factTarget.kind, "milestone");
    assert.equal(typeof (c.factTarget as { id: string }).id, "string");
  }
});

test("developmental: kidSpineId falls back to DB spineId when no context kid", () => {
  const out = developmentalCandidatesFor(dbKid({ spineId: "jude" }), AS_OF);
  assert.ok(out.length > 0);
  assert.equal(out[0]!.citedRecord.kidSpineId, "jude");
});

test("outgrowing: candidate carries citedRecord and NO factTarget", async () => {
  // Fresh temp DB so the engine's SQLite queries have rows to reason from
  // without depending on the developer's real data/copilot.db.
  const dir = mkdtempSync(join(tmpdir(), "copilot-cite-"));
  const dbPath = join(dir, "test.db");
  process.env.COPILOT_DB_PATH = dbPath;

  // Minimal DDL — just the columns the outgrowing engine reads.
  const raw = new Database(dbPath);
  raw.exec(`
    CREATE TABLE kids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      dob TEXT NOT NULL,
      pediatrician TEXT,
      daycare TEXT,
      notes TEXT,
      spine_id TEXT,
      created_at TEXT
    );
    CREATE TABLE measurements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kid_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      measured_on TEXT NOT NULL,
      source TEXT,
      created_at TEXT
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kid_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      occurred_on TEXT NOT NULL,
      description TEXT,
      metadata TEXT,
      created_at TEXT
    );
  `);
  // A toddler with a shoe purchase well in the past → fires outgrowing:shoes.
  raw
    .prepare("INSERT INTO kids (id, name, dob, spine_id) VALUES (?, ?, ?, ?)")
    .run(1, "Clem Pelletier", "2024-01-18", "clem");
  raw
    .prepare(
      "INSERT INTO events (kid_id, type, occurred_on, description, metadata) VALUES (?, ?, ?, ?, ?)",
    )
    .run(1, "gear_purchase", "2025-01-01", "Stride Rite size 6M", JSON.stringify({ item: "shoes" }));
  raw.close();

  // Import the engine AFTER COPILOT_DB_PATH is set so it opens the temp DB.
  const { outgrowingCandidatesFor } = await import("../src/lib/engine/outgrowing.js");
  const clem = dbKid({ id: 1, name: "Clem Pelletier", dob: "2024-01-18", spineId: "clem" });
  const out = outgrowingCandidatesFor(clem, "2026-05-10");

  const shoes = out.find((c) => c.triggerDetail === "outgrowing:shoes");
  assert.ok(shoes, "expected an outgrowing:shoes candidate");
  assertHasCitedRecord(shoes!);
  assert.equal(shoes!.citedRecord.kidSpineId, "clem");
  assert.equal(shoes!.citedRecord.path, "gear.shoe_size");
  assert.equal(shoes!.factTarget, undefined, "outgrowing is suppression-only");
});

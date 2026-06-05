/**
 * U6 — Suppression + quarantine filter pass tests.
 *
 * Runs against a fresh temp DB (COPILOT_DB_PATH + minimal DDL, mirroring
 * tests/citation.test.ts) and a temp copy of family_context.example.json
 * (mirroring tests/spine_write.test.ts). The module is imported AFTER
 * COPILOT_DB_PATH is set so db/index.ts opens the temp file.
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import type { Candidate } from "../src/lib/engine/types.js";

const EXAMPLE = "./data/family_context.example.json";
const KID_SPINE = "kid_a"; // the example file's single kid id
const KID_DB_ID = 1;
const AS_OF = "2026-06-05";

let raw: Database.Database;
let spinePath: string;
let filterCandidates: typeof import("../src/lib/engine/candidate_filter.js").filterCandidates;
let redactQuarantined: typeof import("../src/lib/engine/candidate_filter.js").redactQuarantined;

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    kidId: KID_DB_ID,
    headline: "h",
    body: "b",
    triggerSource: "lookahead",
    triggerDetail: "outgrowing:shoes",
    reasoning: "r",
    confidence: "medium",
    rawScore: 50,
    citedRecord: { kidSpineId: KID_SPINE, path: "gear.shoe_size" },
    ...overrides,
  };
}

function insertSuppression(
  triggerDetail: string,
  revalidationKind: string,
  revalidationParams: Record<string, unknown> | null,
): void {
  raw
    .prepare(
      "INSERT INTO suppressions (kid_spine_id, trigger_detail, revalidation_kind, revalidation_params) VALUES (?, ?, ?, ?)",
    )
    .run(
      KID_SPINE,
      triggerDetail,
      revalidationKind,
      revalidationParams === null ? null : JSON.stringify(revalidationParams),
    );
}

function clearTables(): void {
  raw.exec("DELETE FROM suppressions; DELETE FROM quarantines; DELETE FROM measurements;");
}

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "copilot-cfilter-"));
  const dbPath = join(dir, "test.db");
  process.env.COPILOT_DB_PATH = dbPath;

  raw = new Database(dbPath);
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
    CREATE TABLE suppressions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kid_spine_id TEXT NOT NULL,
      trigger_detail TEXT NOT NULL,
      revalidation_kind TEXT NOT NULL,
      revalidation_params TEXT,
      source_reaction_id INTEGER,
      created_at TEXT
    );
    CREATE TABLE quarantines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kid_spine_id TEXT NOT NULL,
      record_path TEXT NOT NULL,
      reason TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      lifted_at TEXT,
      created_at TEXT
    );
  `);
  raw
    .prepare("INSERT INTO kids (id, name, dob, spine_id) VALUES (?, ?, ?, ?)")
    .run(KID_DB_ID, "Example Kid A", "2024-01-18", KID_SPINE);

  // Temp spine copy so milestone reads have a kid_a with a cleared milestone.
  const sdir = mkdtempSync(join(tmpdir(), "copilot-cfilter-spine-"));
  spinePath = join(sdir, "family_context.json");
  copyFileSync(EXAMPLE, spinePath);

  // Import AFTER COPILOT_DB_PATH is set.
  const mod = await import("../src/lib/engine/candidate_filter.js");
  filterCandidates = mod.filterCandidates;
  redactQuarantined = mod.redactQuarantined;
});

// --- measurement_band ------------------------------------------------------

test("measurement_band: drops at band N, keeps once a newer measurement crosses N+1", () => {
  clearTables();
  // Suppressed at clothing band 24 months, recorded 2026-01-01.
  insertSuppression("outgrowing:clothing", "measurement_band", {
    type: "clothing_size_months",
    value: 24,
    measuredOn: "2026-01-01",
  });
  const c = candidate({
    triggerDetail: "outgrowing:clothing",
    citedRecord: { kidSpineId: KID_SPINE, path: "gear.clothing_size" },
  });

  // No newer crossing measurement yet → still suppressed (dropped).
  assert.equal(filterCandidates([c], { asOf: AS_OF, contextPath: spinePath }).length, 0);

  // A newer measurement at band N+1 (36mo, after the stored date) → resurface.
  raw
    .prepare(
      "INSERT INTO measurements (kid_id, type, value, unit, measured_on) VALUES (?, ?, ?, ?, ?)",
    )
    .run(KID_DB_ID, "clothing_size_months", 36, "months", "2026-05-01");
  assert.equal(filterCandidates([c], { asOf: AS_OF, contextPath: spinePath }).length, 1);
});

test("measurement_band: a same-day LARGER measurement crosses the band (resurfaces)", () => {
  clearTables();
  // Suppressed at clothing band 24mo, recorded 2026-01-01.
  insertSuppression("outgrowing:clothing", "measurement_band", {
    type: "clothing_size_months",
    value: 24,
    measuredOn: "2026-01-01",
  });
  const c = candidate({
    triggerDetail: "outgrowing:clothing",
    citedRecord: { kidSpineId: KID_SPINE, path: "gear.clothing_size" },
  });

  // The band measurement itself (same date, same value) must NOT resurface it.
  raw
    .prepare(
      "INSERT INTO measurements (kid_id, type, value, unit, measured_on) VALUES (?, ?, ?, ?, ?)",
    )
    .run(KID_DB_ID, "clothing_size_months", 24, "months", "2026-01-01");
  assert.equal(
    filterCandidates([c], { asOf: AS_OF, contextPath: spinePath }).length,
    0,
    "the band measurement itself does not cross (value not > band)",
  );

  // A LARGER measurement logged on the SAME date as the band → crosses → resurface.
  raw
    .prepare(
      "INSERT INTO measurements (kid_id, type, value, unit, measured_on) VALUES (?, ?, ?, ?, ?)",
    )
    .run(KID_DB_ID, "clothing_size_months", 36, "months", "2026-01-01");
  assert.equal(
    filterCandidates([c], { asOf: AS_OF, contextPath: spinePath }).length,
    1,
    "same-day larger measurement crosses the band",
  );
});

test("measurement_band: with NO measurement stays suppressed (dropped)", () => {
  clearTables();
  insertSuppression("outgrowing:shoes", "measurement_band", {
    type: "shoe_size_us",
    value: 8,
    measuredOn: "2026-01-01",
  });
  const c = candidate({ triggerDetail: "outgrowing:shoes" });
  // No measurement at all for shoe_size_us → resurfacing requires a reading.
  assert.equal(filterCandidates([c], { asOf: AS_OF, contextPath: spinePath }).length, 0);
});

// --- quarantine ------------------------------------------------------------

test("quarantine: cited record dropped while active, kept after lift", async () => {
  clearTables();
  raw
    .prepare(
      "INSERT INTO quarantines (kid_spine_id, record_path, active) VALUES (?, ?, 1)",
    )
    .run(KID_SPINE, "gear.shoe_size");
  const c = candidate({ citedRecord: { kidSpineId: KID_SPINE, path: "gear.shoe_size" } });

  assert.equal(filterCandidates([c], { asOf: AS_OF, contextPath: spinePath }).length, 0);

  // Lift the quarantine (matches liftQuarantine: active=false).
  const { liftQuarantine, activeQuarantines } = await import("../src/lib/spine_write.js");
  const q = activeQuarantines(KID_SPINE).find((x) => x.recordPath === "gear.shoe_size")!;
  liftQuarantine(q.id);

  assert.equal(filterCandidates([c], { asOf: AS_OF, contextPath: spinePath }).length, 1);
});

// --- forever / until_date --------------------------------------------------

test("forever: always drops", () => {
  clearTables();
  insertSuppression("outgrowing:shoes", "forever", null);
  const c = candidate({ triggerDetail: "outgrowing:shoes" });
  assert.equal(filterCandidates([c], { asOf: AS_OF, contextPath: spinePath }).length, 0);
});

test("until_date: drops before the date, keeps after", () => {
  clearTables();
  insertSuppression("outgrowing:shoes", "until_date", { date: "2026-09-01" });
  const c = candidate({ triggerDetail: "outgrowing:shoes" });

  // asOf (2026-06-05) < date → dropped.
  assert.equal(filterCandidates([c], { asOf: "2026-06-05", contextPath: spinePath }).length, 0);
  // asOf after the date → condition lapsed → kept.
  assert.equal(filterCandidates([c], { asOf: "2026-10-01", contextPath: spinePath }).length, 1);
});

// --- until_milestone_change ------------------------------------------------

test("until_milestone_change: drops while milestone still cleared", () => {
  clearTables();
  // Example spine kid_a has milestone simple_sentences_3_4_words = "cleared".
  insertSuppression("developmental:simple_sentences", "until_milestone_change", {
    milestoneId: "simple_sentences_3_4_words",
    status: "cleared",
  });
  const c = candidate({
    triggerDetail: "developmental:simple_sentences",
    citedRecord: { kidSpineId: KID_SPINE, path: "developmental.milestones[0]" },
  });
  assert.equal(filterCandidates([c], { asOf: AS_OF, contextPath: spinePath }).length, 0);
});

// --- pass-through ----------------------------------------------------------

test("no suppression / no quarantine: passes through", () => {
  clearTables();
  const c = candidate();
  const out = filterCandidates([c], { asOf: AS_OF, contextPath: spinePath });
  assert.equal(out.length, 1);
  assert.equal(out[0], c);
});

// --- redactQuarantined -----------------------------------------------------

test("redactQuarantined removes quarantined path from a copy, leaves original intact", () => {
  clearTables();
  raw
    .prepare(
      "INSERT INTO quarantines (kid_spine_id, record_path, active) VALUES (?, ?, 1)",
    )
    .run(KID_SPINE, "medical.last_well_visit");

  const original = {
    family: { household_name: "X" },
    kids: [
      {
        id: KID_SPINE,
        name: "Example Kid A",
        medical: { last_well_visit: "2025-06-01", conditions: [] },
      },
    ],
    history: {},
  };

  const redacted = redactQuarantined(original);

  // Original untouched.
  assert.equal(original.kids[0]!.medical.last_well_visit, "2025-06-01");
  // Copy redacted at the quarantined path.
  const rkids = (redacted as typeof original).kids;
  assert.notEqual(rkids[0]!.medical.last_well_visit, "2025-06-01");
  assert.match(String(rkids[0]!.medical.last_well_visit), /redacted/);
  // Untouched fields preserved on the copy.
  assert.deepEqual(rkids[0]!.medical.conditions, []);
});

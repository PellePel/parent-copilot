/**
 * U2 — novelty / week-over-week ranking signal.
 *
 * noveltyScore reads the recent brief history (briefs ⋈ brief_items). Shared
 * temp DB for the file (the db module caches its connection at load), seeded
 * fresh per test.
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import type { Candidate } from "../src/lib/engine/types.js";

const AS_OF = "2026-05-10";

const dir = mkdtempSync(join(tmpdir(), "copilot-novelty-"));
const dbPath = join(dir, "test.db");
process.env.COPILOT_DB_PATH = dbPath;

const raw = new Database(dbPath);
raw.exec(`
  CREATE TABLE briefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    generated_at TEXT, week_of TEXT NOT NULL, recipients TEXT
  );
  CREATE TABLE brief_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brief_id INTEGER NOT NULL, kid_id INTEGER, trigger_detail TEXT
  );
`);

const { noveltyScore, NOVELTY_WEEKS_BACK } = await import("../src/lib/engine/novelty.js");

beforeEach(() => {
  raw.exec("DELETE FROM brief_items; DELETE FROM briefs;");
});

/** Seed a brief for `weekOf` containing one item for (kidId, triggerDetail). */
function seedBriefItem(weekOf: string, kidId: number | null, triggerDetail: string): void {
  const info = raw.prepare("INSERT INTO briefs (week_of) VALUES (?)").run(weekOf);
  raw
    .prepare("INSERT INTO brief_items (brief_id, kid_id, trigger_detail) VALUES (?, ?, ?)")
    .run(info.lastInsertRowid, kidId, triggerDetail);
}

function cand(kidId: number | null, triggerDetail: string): Candidate {
  return {
    kidId,
    headline: "h",
    body: "b",
    triggerSource: "lookahead",
    triggerDetail,
    reasoning: "r",
    confidence: "medium",
    rawScore: 50,
    citedRecord: { kidSpineId: "jude", path: "x" },
  };
}

test("repeated item scores lower than an identical-rawScore first-time item", () => {
  // Same (kid, triggerDetail) headlined each of the last 3 weekly briefs.
  seedBriefItem("2026-05-03", 1, "developmental:peekaboo");
  seedBriefItem("2026-04-26", 1, "developmental:peekaboo");
  seedBriefItem("2026-04-19", 1, "developmental:peekaboo");

  const repeated = noveltyScore(cand(1, "developmental:peekaboo"), AS_OF);
  const fresh = noveltyScore(cand(1, "gear:sleep_sack"), AS_OF);

  assert.ok(repeated < fresh, `repeated (${repeated}) should score below fresh (${fresh})`);
  assert.equal(fresh, 100, "a never-seen item scores the base");
});

test("an item not fired within the window gets the full novelty score", () => {
  // Appeared, but outside the lookback window.
  seedBriefItem("2026-01-01", 1, "developmental:peekaboo");
  assert.equal(noveltyScore(cand(1, "developmental:peekaboo"), AS_OF), 100);
});

test("empty brief history → every candidate is fully novel, no crash", () => {
  assert.equal(noveltyScore(cand(1, "developmental:peekaboo"), AS_OF), 100);
});

test("family-level (kidId null) candidate is scored without throwing", () => {
  seedBriefItem("2026-05-03", null, "crossproduct:travel");
  const score = noveltyScore(cand(null, "crossproduct:travel"), AS_OF);
  assert.equal(score, 75, "one recent appearance → one penalty");
  // A different family-level trigger is untouched.
  assert.equal(noveltyScore(cand(null, "crossproduct:holiday"), AS_OF), 100);
});

test("the lookback window is the documented length", () => {
  assert.equal(NOVELTY_WEEKS_BACK, 6);
});

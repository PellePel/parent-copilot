/**
 * U3 — week-view read model.
 *
 * Shared temp DB for the file (db connection caches at load). Each test reseeds
 * briefs + brief_items + kids.
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const AS_OF = "2026-05-10";

const dir = mkdtempSync(join(tmpdir(), "copilot-weekview-"));
const dbPath = join(dir, "test.db");
process.env.COPILOT_DB_PATH = dbPath;

const raw = new Database(dbPath);
raw.exec(`
  CREATE TABLE kids (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, dob TEXT NOT NULL,
    pediatrician TEXT, daycare TEXT, notes TEXT, spine_id TEXT, created_at TEXT
  );
  CREATE TABLE briefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, generated_at TEXT,
    week_of TEXT NOT NULL, recipients TEXT NOT NULL
  );
  CREATE TABLE brief_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brief_id INTEGER NOT NULL, kid_id INTEGER,
    headline TEXT NOT NULL, body TEXT NOT NULL, suggested_action TEXT,
    trigger_source TEXT NOT NULL, trigger_detail TEXT,
    reasoning TEXT NOT NULL, confidence TEXT NOT NULL, priority INTEGER NOT NULL,
    related_to_current_edge TEXT, telegram_message_id INTEGER, delivered_at TEXT,
    cited_record TEXT, fact_target TEXT
  );
`);
raw.prepare("INSERT INTO kids (id, name, dob, spine_id) VALUES (?, ?, ?, ?)").run(1, "Jude Pelletier", "2025-12-07", "jude");

const { buildWeekView } = await import("../src/lib/engine/week_view.js");

beforeEach(() => {
  raw.exec("DELETE FROM brief_items; DELETE FROM briefs;");
});

function seedBrief(weekOf: string): number {
  const info = raw.prepare("INSERT INTO briefs (week_of, recipients) VALUES (?, ?)").run(weekOf, "[]");
  return Number(info.lastInsertRowid);
}

function seedItem(
  briefId: number,
  triggerDetail: string,
  priority: number,
  opts: { kidId?: number | null; headline?: string } = {},
): void {
  raw
    .prepare(
      `INSERT INTO brief_items
        (brief_id, kid_id, headline, body, trigger_source, trigger_detail, reasoning, confidence, priority, cited_record)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      briefId,
      opts.kidId === undefined ? 1 : opts.kidId,
      opts.headline ?? `item ${triggerDetail}`,
      "body",
      "lookahead",
      triggerDetail,
      "reasoning",
      "high",
      priority,
      JSON.stringify({ kidSpineId: "jude", path: "x" }),
    );
}

test("R2/R3: a non-calendar forecast leads; appointments go to the strip", () => {
  const b = seedBrief(AS_OF);
  seedItem(b, "allergen:start", 2, { headline: "Start peanut soon" });
  seedItem(b, "vaccine_prep", 1, { headline: "6-month shots coming" });
  seedItem(b, "absence:well_visit:9", 3, { headline: "Well visit Tue" });
  seedItem(b, "crossproduct:travel", 4, { headline: "Trip Friday", kidId: null });

  const wv = buildWeekView(AS_OF);
  assert.equal(wv.weekOf, AS_OF);
  assert.ok(wv.hero, "expected a hero");
  assert.equal(wv.hero!.triggerDetail, "allergen:start", "non-calendar item leads");
  // All three calendar families land in the strip, none as hero.
  const stripTriggers = wv.strip.map((i) => i.triggerDetail);
  assert.deepEqual(new Set(stripTriggers), new Set(["vaccine_prep", "absence:well_visit:9", "crossproduct:travel"]));
  assert.ok(!wv.strip.some((i) => i === wv.hero));
});

test("R4: a fresher non-calendar item out-headlines a repeated one with better priority", () => {
  // developmental:peekaboo headlined the last 3 weeks; gear:sleep_sack is new.
  for (const w of ["2026-05-03", "2026-04-26", "2026-04-19"]) {
    const pb = seedBrief(w);
    seedItem(pb, "developmental:peekaboo", 1);
  }
  const b = seedBrief(AS_OF);
  seedItem(b, "developmental:peekaboo", 1); // better assembler priority...
  seedItem(b, "outgrowing:sleep_sack", 2); // ...but stale loses to fresh

  const wv = buildWeekView(AS_OF);
  assert.equal(wv.hero!.triggerDetail, "outgrowing:sleep_sack", "fresher item should headline");
  assert.ok(wv.more.some((i) => i.triggerDetail === "developmental:peekaboo"), "stale item demoted to 'more'");
});

test("note-derived actions passed in are surfaced", () => {
  const b = seedBrief(AS_OF);
  seedItem(b, "developmental:peekaboo", 1);
  const wv = buildWeekView(AS_OF, {
    actions: [{ id: 1, kidSpineId: "jude", forecastText: "Sleep sack soon", actionText: "Order size M", actionKind: "one_shot" }],
  });
  assert.equal(wv.actions.length, 1);
  assert.equal(wv.actions[0]!.actionKind, "one_shot");
});

test("no brief for the week → empty but valid view", () => {
  const wv = buildWeekView(AS_OF);
  assert.equal(wv.weekOf, null);
  assert.equal(wv.hero, null);
  assert.deepEqual(wv.more, []);
  assert.deepEqual(wv.strip, []);
  assert.deepEqual(wv.actions, []);
});

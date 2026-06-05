/**
 * U7 — Reaction dispatch tests.
 *
 * Temp DB via COPILOT_DB_PATH (minimal DDL mirroring the tables reactions.ts
 * touches) + a temp spine copied from the example file (so spine mutations
 * don't touch data/). `reactions.ts` is imported AFTER COPILOT_DB_PATH is set
 * so db/index.ts opens the temp DB.
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const EXAMPLE = "./data/family_context.example.json";
const KID_SPINE = "kid_a"; // the example file's single kid id

let raw: InstanceType<typeof Database>;
let applyReaction: typeof import("../src/lib/reactions.js").applyReaction;

/** Copy the example spine into a fresh temp file and return its path. */
function tempSpine(): string {
  const dir = mkdtempSync(join(tmpdir(), "copilot-react-spine-"));
  const path = join(dir, "family_context.json");
  copyFileSync(EXAMPLE, path);
  return path;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function kidOf(path: string): Record<string, unknown> {
  const kids = readJson(path)["kids"] as Array<Record<string, unknown>>;
  return kids.find((k) => k["id"] === KID_SPINE)!;
}

/** Insert a brief_items row, returning its id. */
function seedBriefItem(opts: {
  triggerDetail: string;
  citedRecord: Record<string, unknown> | null;
  factTarget: Record<string, unknown> | null;
  reasoning?: string;
  kidId?: number | null;
}): number {
  const info = raw
    .prepare(
      `INSERT INTO brief_items
       (brief_id, kid_id, headline, body, trigger_source, trigger_detail, reasoning,
        confidence, priority, cited_record, fact_target)
       VALUES (1, ?, 'h', 'b', 'lookahead', ?, ?, 'high', 1, ?, ?)`,
    )
    .run(
      opts.kidId === undefined ? 1 : opts.kidId,
      opts.triggerDetail,
      opts.reasoning ?? "because the engine said so",
      opts.citedRecord ? JSON.stringify(opts.citedRecord) : null,
      opts.factTarget ? JSON.stringify(opts.factTarget) : null,
    );
  return Number(info.lastInsertRowid);
}

function count(table: string, where = "1=1", ...args: unknown[]): number {
  const row = raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args) as {
    n: number;
  };
  return row.n;
}

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "copilot-react-"));
  const dbPath = join(dir, "test.db");
  process.env.COPILOT_DB_PATH = dbPath;

  raw = new Database(dbPath);
  raw.exec(`
    CREATE TABLE kids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, dob TEXT NOT NULL, pediatrician TEXT, daycare TEXT,
      notes TEXT, spine_id TEXT, created_at TEXT
    );
    CREATE TABLE measurements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kid_id INTEGER NOT NULL, type TEXT NOT NULL, value REAL NOT NULL,
      unit TEXT NOT NULL, measured_on TEXT NOT NULL, source TEXT, created_at TEXT
    );
    CREATE TABLE brief_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brief_id INTEGER NOT NULL, kid_id INTEGER, headline TEXT NOT NULL, body TEXT NOT NULL,
      suggested_action TEXT, trigger_source TEXT NOT NULL, trigger_detail TEXT,
      reasoning TEXT NOT NULL, confidence TEXT NOT NULL, priority INTEGER NOT NULL,
      related_to_current_edge TEXT, telegram_message_id INTEGER, delivered_at TEXT,
      cited_record TEXT, fact_target TEXT
    );
    CREATE TABLE reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brief_item_id INTEGER NOT NULL, reaction TEXT NOT NULL, telegram_callback_id TEXT,
      prompt_message_id INTEGER, reply_message_id INTEGER, correction_text TEXT,
      applied_status TEXT NOT NULL DEFAULT 'n/a', created_at TEXT
    );
    CREATE TABLE suppressions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kid_spine_id TEXT NOT NULL, trigger_detail TEXT NOT NULL, revalidation_kind TEXT NOT NULL,
      revalidation_params TEXT, source_reaction_id INTEGER, created_at TEXT
    );
    CREATE TABLE quarantines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kid_spine_id TEXT NOT NULL, record_path TEXT NOT NULL, reason TEXT,
      active INTEGER NOT NULL DEFAULT 1, lifted_at TEXT, created_at TEXT
    );
    CREATE TABLE factual_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brief_item_id INTEGER NOT NULL, kid_spine_id TEXT NOT NULL, cited_record TEXT,
      resolved_at TEXT, created_at TEXT
    );
    CREATE TABLE delight_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brief_item_id INTEGER NOT NULL, kid_spine_id TEXT NOT NULL, trigger_detail TEXT,
      created_at TEXT
    );
  `);
  // One kid whose spine_id matches the example file's kid id.
  raw
    .prepare("INSERT INTO kids (id, name, dob, spine_id) VALUES (1, 'Example Kid A', '2024-01-18', 'kid_a')")
    .run();

  ({ applyReaction } = await import("../src/lib/reactions.js"));
});

// --- Tests -----------------------------------------------------------------

test("handled on an allergen item: spine updated + suppression + delight row", async () => {
  const path = tempSpine();
  const id = seedBriefItem({
    triggerDetail: "allergen_window",
    citedRecord: { kidSpineId: KID_SPINE, path: "patterns.eating.allergen_introduction_status" },
    factTarget: { kind: "allergen", allergen: "peanut" },
  });

  const result = await applyReaction(id, "handled", `cb-allergen-${id}`, { contextPath: path });
  assert.equal(result.kind, "fact_updated");

  // Spine: peanut moved to introduced.
  const status = (
    (kidOf(path)["patterns"] as Record<string, unknown>)["eating"] as Record<string, unknown>
  )["allergen_introduction_status"] as Record<string, unknown>;
  assert.ok((status["introduced"] as string[]).includes("peanut"));
  assert.ok(!(status["not_yet_introduced"] as string[]).includes("peanut"));

  assert.equal(count("suppressions", "trigger_detail = ?", "allergen_window"), 1);
  assert.equal(count("delight_candidates", "brief_item_id = ?", id), 1);
});

test("already_knew: suppression but NO delight row", async () => {
  const path = tempSpine();
  const id = seedBriefItem({
    triggerDetail: "developmental:rolling_over",
    citedRecord: { kidSpineId: KID_SPINE, path: "developmental.milestones[0]" },
    factTarget: { kind: "milestone", id: "simple_sentences_3_4_words" },
  });

  const result = await applyReaction(id, "already_knew", `cb-ak-${id}`, { contextPath: path });
  assert.equal(result.kind, "suppressed");

  assert.equal(count("suppressions", "trigger_detail = ?", "developmental:rolling_over"), 1);
  assert.equal(count("delight_candidates", "brief_item_id = ?", id), 0);

  // milestone cleared + added to things_we_already_know in the spine.
  const dev = kidOf(path)["developmental"] as Record<string, unknown>;
  const m = (dev["milestones"] as Array<Record<string, unknown>>).find(
    (x) => x["milestone"] === "simple_sentences_3_4_words",
  )!;
  assert.equal(m["status"], "cleared");
  assert.ok((dev["things_we_already_know"] as string[]).includes("simple_sentences_3_4_words"));
});

test("wrong: active quarantine + factual_errors row + reaction appliedStatus pending", async () => {
  const path = tempSpine();
  const id = seedBriefItem({
    triggerDetail: "medication_followup",
    citedRecord: { kidSpineId: KID_SPINE, path: "medical.medications[0]" },
    factTarget: null,
  });

  const result = await applyReaction(id, "wrong", `cb-wrong-${id}`, { contextPath: path });
  assert.equal(result.kind, "quarantined");
  assert.equal((result as { needsCorrection: boolean }).needsCorrection, true);
  assert.equal(typeof result.reactionId, "number");

  assert.equal(
    count("quarantines", "record_path = ? AND active = 1", "medical.medications[0]"),
    1,
  );
  assert.equal(count("factual_errors", "brief_item_id = ?", id), 1);
  assert.equal(count("reactions", "brief_item_id = ? AND applied_status = 'pending'", id), 1);
});

test("tell_more: returns reasoning, no DB / spine mutation", async () => {
  const path = tempSpine();
  const before = readFileSync(path, "utf8");
  const id = seedBriefItem({
    triggerDetail: "developmental:walking",
    citedRecord: { kidSpineId: KID_SPINE, path: "developmental.milestones[0]" },
    factTarget: { kind: "milestone", id: "walking" },
    reasoning: "kid is in the typical walking window",
  });

  const result = await applyReaction(id, "tell_more", `cb-tm-${id}`, { contextPath: path });
  assert.equal(result.kind, "reveal_reasoning");
  assert.equal(
    (result as { reasoning: string }).reasoning,
    "kid is in the typical walking window",
  );
  assert.equal(typeof result.reactionId, "number");

  assert.equal(count("suppressions", "trigger_detail = ?", "developmental:walking"), 0);
  assert.equal(count("delight_candidates", "brief_item_id = ?", id), 0);
  assert.equal(readFileSync(path, "utf8"), before, "spine untouched");
});

test("idempotency: same telegramCallbackId twice → one suppression, one delight row", async () => {
  const path = tempSpine();
  const id = seedBriefItem({
    triggerDetail: "allergen_window",
    citedRecord: { kidSpineId: KID_SPINE, path: "patterns.eating.allergen_introduction_status" },
    factTarget: { kind: "allergen", allergen: "egg" },
  });
  const cb = `cb-idem-${id}`;

  const first = await applyReaction(id, "handled", cb, { contextPath: path });
  const second = await applyReaction(id, "handled", cb, { contextPath: path });

  assert.equal(first.kind, "fact_updated");
  assert.equal(second.kind, "noop_duplicate");
  // noop_duplicate surfaces the PRIOR (winning) row's id.
  assert.equal(second.reactionId, first.reactionId);

  assert.equal(count("suppressions", "trigger_detail = ? AND kid_spine_id = ?", "allergen_window", KID_SPINE), 1);
  assert.equal(count("delight_candidates", "brief_item_id = ?", id), 1);
  assert.equal(count("reactions", "telegram_callback_id = ?", cb), 1);
});

test("handled on outgrowing:shoes WITH a measurement → measurement_band params", async () => {
  const path = tempSpine();
  raw
    .prepare(
      "INSERT INTO measurements (kid_id, type, value, unit, measured_on) VALUES (1, 'shoe_size_us', 7.5, 'us', '2026-01-15')",
    )
    .run();
  const id = seedBriefItem({
    triggerDetail: "outgrowing:shoes",
    citedRecord: { kidSpineId: KID_SPINE, path: "gear.shoe_size" },
    factTarget: null,
  });

  const result = await applyReaction(id, "handled", `cb-shoes-${id}`, { contextPath: path });
  assert.equal(result.kind, "suppressed"); // no factTarget → suppression only

  const supp = raw
    .prepare("SELECT revalidation_kind, revalidation_params FROM suppressions WHERE trigger_detail = ?")
    .get("outgrowing:shoes") as { revalidation_kind: string; revalidation_params: string };
  assert.equal(supp.revalidation_kind, "measurement_band");
  assert.deepEqual(JSON.parse(supp.revalidation_params), {
    type: "shoe_size_us",
    value: 7.5,
    measuredOn: "2026-01-15",
  });
});

test("handled on outgrowing:clothing with NO measurement → forever", async () => {
  const path = tempSpine();
  const id = seedBriefItem({
    triggerDetail: "outgrowing:clothing",
    citedRecord: { kidSpineId: KID_SPINE, path: "gear.clothing_size" },
    factTarget: null,
  });

  const result = await applyReaction(id, "handled", `cb-cloth-${id}`, { contextPath: path });
  assert.equal(result.kind, "suppressed");

  const supp = raw
    .prepare("SELECT revalidation_kind, revalidation_params FROM suppressions WHERE trigger_detail = ?")
    .get("outgrowing:clothing") as { revalidation_kind: string; revalidation_params: string | null };
  assert.equal(supp.revalidation_kind, "forever");
});

test("handled on a vaccine_prep/medication item (no factTarget) → suppression only, no spine fact change", async () => {
  const path = tempSpine();
  const before = readFileSync(path, "utf8");
  const id = seedBriefItem({
    triggerDetail: "medication_followup",
    citedRecord: { kidSpineId: KID_SPINE, path: "medical.medications[0]" },
    factTarget: null,
  });

  const result = await applyReaction(id, "handled", `cb-med-${id}`, { contextPath: path });
  assert.equal(result.kind, "suppressed");

  const supp = raw
    .prepare("SELECT revalidation_kind FROM suppressions WHERE trigger_detail = ? AND kid_spine_id = ?")
    .get("medication_followup", KID_SPINE) as { revalidation_kind: string };
  assert.equal(supp.revalidation_kind, "forever");
  // No factTarget → spine never mutated (delight row still recorded for "handled").
  assert.equal(readFileSync(path, "utf8"), before, "spine untouched (no fact mutation)");
  assert.equal(count("delight_candidates", "brief_item_id = ?", id), 1);
});

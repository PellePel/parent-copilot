/**
 * U8 — Async correction applier tests.
 *
 * Temp DB via COPILOT_DB_PATH (minimal DDL mirroring the tables correct.ts
 * touches) + a temp spine copied from the example file. A STUBBED client
 * returns a fixed structured tool_use response — no real API key. `correct.ts`
 * is imported AFTER COPILOT_DB_PATH is set so db/index.ts opens the temp DB.
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
let applyCorrection: typeof import("../src/lib/correct.js").applyCorrection;
type CorrectionClient = import("../src/lib/correct.js").CorrectionClient;

/** Copy the example spine into a fresh temp file and return its path. */
function tempSpine(): string {
  const dir = mkdtempSync(join(tmpdir(), "copilot-correct-spine-"));
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

function count(table: string, where = "1=1", ...args: unknown[]): number {
  const row = raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...args) as {
    n: number;
  };
  return row.n;
}

/** A stub client whose single call returns the given tool input as a tool_use block. */
function stubClient(toolInput: unknown): CorrectionClient {
  return {
    messages: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async () =>
        ({
          content: [{ type: "tool_use", name: "submit_correction", id: "x", input: toolInput }],
          usage: { input_tokens: 0, output_tokens: 0 },
        }) as any,
    },
  };
}

/** Seed a pending "wrong" reaction over a brief item + a matching active quarantine + factual_error. */
function seedPendingCorrection(opts: {
  citedPath: string;
  correctionText: string;
}): { reactionId: number; briefItemId: number; quarantineId: number } {
  const itemInfo = raw
    .prepare(
      `INSERT INTO brief_items
       (brief_id, kid_id, headline, body, trigger_source, trigger_detail, reasoning,
        confidence, priority, cited_record, fact_target)
       VALUES (1, 1, 'h', 'b', 'lookahead', 'medication_followup', 'engine said so', 'high', 1, ?, NULL)`,
    )
    .run(JSON.stringify({ kidSpineId: KID_SPINE, path: opts.citedPath }));
  const briefItemId = Number(itemInfo.lastInsertRowid);

  const reactInfo = raw
    .prepare(
      `INSERT INTO reactions (brief_item_id, reaction, telegram_callback_id, correction_text, applied_status)
       VALUES (?, 'wrong', ?, ?, 'pending')`,
    )
    .run(briefItemId, `cb-${briefItemId}`, opts.correctionText);
  const reactionId = Number(reactInfo.lastInsertRowid);

  const qInfo = raw
    .prepare(
      "INSERT INTO quarantines (kid_spine_id, record_path, reason, active) VALUES (?, ?, 'user flagged wrong', 1)",
    )
    .run(KID_SPINE, opts.citedPath);
  const quarantineId = Number(qInfo.lastInsertRowid);
  raw
    .prepare(
      "INSERT INTO factual_errors (brief_item_id, kid_spine_id, cited_record, resolved_at) VALUES (?, ?, ?, NULL)",
    )
    .run(briefItemId, KID_SPINE, JSON.stringify({ kidSpineId: KID_SPINE, path: opts.citedPath }));

  return { reactionId, briefItemId, quarantineId };
}

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "copilot-correct-"));
  const dbPath = join(dir, "test.db");
  process.env.COPILOT_DB_PATH = dbPath;

  raw = new Database(dbPath);
  raw.exec(`
    CREATE TABLE kids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, dob TEXT NOT NULL, pediatrician TEXT, daycare TEXT,
      notes TEXT, spine_id TEXT, created_at TEXT
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
  `);
  raw
    .prepare("INSERT INTO kids (id, name, dob, spine_id) VALUES (1, 'Example Kid A', '2024-01-18', 'kid_a')")
    .run();

  ({ applyCorrection } = await import("../src/lib/correct.js"));
});

// --- Tests -----------------------------------------------------------------

test("happy: confident in-subtree diff → spine written, quarantine lifted, applied, factual_error resolved", async () => {
  const path = tempSpine();
  const { reactionId, briefItemId, quarantineId } = seedPendingCorrection({
    citedPath: "gear.clothing_size",
    correctionText: "She's actually in 3T now, not the old size.",
  });
  const client = stubClient({ path: "gear.clothing_size", value: "3T", confident: true });

  const result = await applyCorrection(reactionId, { client, contextPath: path });
  assert.deepEqual(result, { status: "applied" });

  // Spine changed and still loads.
  const gear = kidOf(path)["gear"] as Record<string, unknown>;
  assert.equal(gear["clothing_size"], "3T");

  // Quarantine lifted.
  assert.equal(count("quarantines", "id = ? AND active = 1", quarantineId), 0);
  // Reaction applied.
  assert.equal(count("reactions", "id = ? AND applied_status = 'applied'", reactionId), 1);
  // factual_error resolved.
  const fe = raw
    .prepare("SELECT resolved_at FROM factual_errors WHERE brief_item_id = ?")
    .get(briefItemId) as { resolved_at: string | null };
  assert.ok(fe.resolved_at, "factual_error.resolvedAt stamped");
});

test("ambiguous: confident:false → parked, quarantine still active, no spine write", async () => {
  const path = tempSpine();
  const before = readFileSync(path, "utf8");
  const { reactionId, quarantineId } = seedPendingCorrection({
    citedPath: "gear.clothing_size",
    correctionText: "that's wrong",
  });
  const client = stubClient({ path: "", confident: false });

  const result = await applyCorrection(reactionId, { client, contextPath: path });
  assert.equal(result.status, "parked");

  assert.equal(count("reactions", "id = ? AND applied_status = 'parked'", reactionId), 1);
  assert.equal(count("quarantines", "id = ? AND active = 1", quarantineId), 1);
  assert.equal(readFileSync(path, "utf8"), before, "spine untouched");
});

test("out-of-subtree: path targets a root key → applySpineDiff throws → parked, no write", async () => {
  const path = tempSpine();
  const before = readFileSync(path, "utf8");
  const { reactionId, quarantineId } = seedPendingCorrection({
    citedPath: "gear.clothing_size",
    correctionText: "fix the household name",
  });
  // Confident, but path escapes the kid subtree (root key "family").
  const client = stubClient({ path: "family.household_name", value: "Hacked", confident: true });

  const result = await applyCorrection(reactionId, { client, contextPath: path });
  assert.equal(result.status, "parked");

  assert.equal(count("reactions", "id = ? AND applied_status = 'parked'", reactionId), 1);
  assert.equal(count("quarantines", "id = ? AND active = 1", quarantineId), 1);
  assert.equal(readFileSync(path, "utf8"), before, "spine untouched");
});

test("re-parse guard: schema-breaking value (kid.dob non-date) is rejected by spine_write → parked, spine untouched", async () => {
  const path = tempSpine();
  const before = readFileSync(path, "utf8");
  const { reactionId, quarantineId } = seedPendingCorrection({
    citedPath: "dob",
    correctionText: "her birthday is sometime in spring",
  });
  // In-subtree path, but a value that breaks the strict-outside schema (dob must be YYYY-MM-DD).
  const client = stubClient({ path: "dob", value: "spring 2024", confident: true });

  const result = await applyCorrection(reactionId, { client, contextPath: path });
  assert.equal(result.status, "parked");

  assert.equal(count("quarantines", "id = ? AND active = 1", quarantineId), 1);
  assert.equal(readFileSync(path, "utf8"), before, "invalid write rejected, spine untouched");
});

test("no-op: a reaction without correctionText is not processed (no LLM, no write)", async () => {
  const path = tempSpine();
  const before = readFileSync(path, "utf8");
  // Pending row but NO correctionText captured yet.
  const itemInfo = raw
    .prepare(
      `INSERT INTO brief_items (brief_id, kid_id, headline, body, trigger_source, reasoning, confidence, priority, cited_record)
       VALUES (1, 1, 'h', 'b', 'lookahead', 'r', 'high', 1, ?)`,
    )
    .run(JSON.stringify({ kidSpineId: KID_SPINE, path: "gear.clothing_size" }));
  const briefItemId = Number(itemInfo.lastInsertRowid);
  const reactInfo = raw
    .prepare(
      "INSERT INTO reactions (brief_item_id, reaction, telegram_callback_id, applied_status) VALUES (?, 'wrong', ?, 'pending')",
    )
    .run(briefItemId, `cb-noop-${briefItemId}`);
  const reactionId = Number(reactInfo.lastInsertRowid);

  // A stub that would THROW if called — proves no LLM call happens.
  const client: CorrectionClient = {
    messages: {
      create: async () => {
        throw new Error("LLM should not be called for a row without correctionText");
      },
    },
  };

  const result = await applyCorrection(reactionId, { client, contextPath: path });
  assert.equal(result.status, "parked");
  // Stays pending (no-op), spine untouched.
  assert.equal(count("reactions", "id = ? AND applied_status = 'pending'", reactionId), 1);
  assert.equal(readFileSync(path, "utf8"), before, "spine untouched");
});

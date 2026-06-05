/**
 * U4 — delivery loop.
 *
 * Exercises deliverBrief with a stubbed sender against a fresh temp DB
 * (mirrors tests/citation.test.ts COPILOT_DB_PATH setup), verifying:
 *  - each item maps to exactly one send,
 *  - on { ok, messageId } the row's telegram_message_id + delivered_at are set,
 *  - on { error } after retries delivered_at stays null and it counts failed,
 *  - on { not_configured } the whole step short-circuits (no rows touched).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import type { BriefItem } from "../src/lib/db/schema.js";
import type { SendResult } from "../src/lib/telegram.js";

// --- Temp DB ----------------------------------------------------------------
// Set COPILOT_DB_PATH before importing the modules that open the DB.
const dir = mkdtempSync(join(tmpdir(), "copilot-deliver-"));
const dbPath = join(dir, "test.db");
process.env.COPILOT_DB_PATH = dbPath;

const raw = new Database(dbPath);
raw.exec(`
  CREATE TABLE briefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    generated_at TEXT,
    week_of TEXT NOT NULL,
    recipients TEXT NOT NULL
  );
  CREATE TABLE brief_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brief_id INTEGER NOT NULL,
    kid_id INTEGER,
    headline TEXT NOT NULL,
    body TEXT NOT NULL,
    suggested_action TEXT,
    trigger_source TEXT NOT NULL,
    trigger_detail TEXT,
    reasoning TEXT NOT NULL,
    confidence TEXT NOT NULL,
    priority INTEGER NOT NULL,
    related_to_current_edge TEXT,
    telegram_message_id INTEGER,
    delivered_at TEXT,
    cited_record TEXT,
    fact_target TEXT
  );
`);
raw.prepare("INSERT INTO briefs (id, week_of, recipients) VALUES (?, ?, ?)").run(
  1,
  "2026-06-07",
  JSON.stringify(["LOCAL"]),
);
function insertItem(id: number, headline: string): void {
  raw
    .prepare(
      `INSERT INTO brief_items
       (id, brief_id, headline, body, trigger_source, reasoning, confidence, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, 1, headline, "body", "schedule", "why", "high", id);
}
insertItem(1, "Item one");
insertItem(2, "Item two");
insertItem(3, "Item three");
raw.close();

// Import AFTER COPILOT_DB_PATH is set so it opens the temp DB.
const { deliverBrief } = await import("../src/lib/deliver.js");
const { db } = await import("../src/lib/db/index.js");
const { briefItems } = await import("../src/lib/db/schema.js");

function fakeItem(id: number): BriefItem {
  return { id, headline: `Item ${id}`, body: "body", suggestedAction: null } as BriefItem;
}

function rowsById(): Map<number, BriefItem> {
  const all = db.select().from(briefItems).all();
  return new Map(all.map((r) => [r.id, r]));
}

// --- Tests ------------------------------------------------------------------

test("deliverBrief: maps each item to one send and stamps message id + delivered_at", async () => {
  const items = [fakeItem(1), fakeItem(2), fakeItem(3)];
  const seen: number[] = [];
  let messageId = 100;
  const send = async (item: BriefItem): Promise<SendResult> => {
    seen.push(item.id);
    return { status: "ok", messageId: messageId++ };
  };

  const result = await deliverBrief(items, { send });

  assert.deepEqual(seen, [1, 2, 3], "each item sent exactly once, in order");
  assert.deepEqual(result, { delivered: 3, failed: 0, notConfigured: false });

  const rows = rowsById();
  assert.equal(rows.get(1)!.telegramMessageId, 100);
  assert.equal(rows.get(2)!.telegramMessageId, 101);
  assert.equal(rows.get(3)!.telegramMessageId, 102);
  for (const id of [1, 2, 3]) {
    assert.ok(rows.get(id)!.deliveredAt, `item ${id} should have delivered_at set`);
  }

  // F1: read the persisted row through a FRESH raw better-sqlite3 connection —
  // independent of the ORM query builder's lazy/thenable semantics — to prove
  // the delivery stamp actually committed to disk (would be null if the update
  // chain were never .run()).
  const probe = new Database(dbPath, { readonly: true });
  const persisted = probe
    .prepare("SELECT telegram_message_id, delivered_at FROM brief_items WHERE id = 1")
    .get() as { telegram_message_id: number | null; delivered_at: string | null };
  probe.close();
  assert.equal(persisted.telegram_message_id, 100, "telegram_message_id persisted to disk");
  assert.ok(persisted.delivered_at, "delivered_at persisted to disk");
});

test("deliverBrief: retries on error, then counts failed and leaves delivered_at null", async () => {
  // Reset delivery state from the previous test.
  db.update(briefItems).set({ telegramMessageId: null, deliveredAt: null }).run();

  let attempts = 0;
  const send = async (_item: BriefItem): Promise<SendResult> => {
    attempts++;
    return { status: "error", reason: "boom" };
  };

  const result = await deliverBrief([fakeItem(1)], {
    send,
    retries: 2,
    retryDelayMs: 0,
  });

  assert.equal(attempts, 3, "1 initial + 2 retries");
  assert.deepEqual(result, { delivered: 0, failed: 1, notConfigured: false });
  const rows = rowsById();
  assert.equal(rows.get(1)!.deliveredAt, null, "failed send must not set delivered_at (R4)");
});

test("deliverBrief: not_configured short-circuits the whole step", async () => {
  db.update(briefItems).set({ telegramMessageId: null, deliveredAt: null }).run();

  let calls = 0;
  const send = async (_item: BriefItem): Promise<SendResult> => {
    calls++;
    return { status: "not_configured", reason: "no token" };
  };

  const result = await deliverBrief([fakeItem(1), fakeItem(2)], { send });

  assert.equal(calls, 1, "stops after the first not_configured");
  assert.deepEqual(result, { delivered: 0, failed: 0, notConfigured: true });
  const rows = rowsById();
  assert.equal(rows.get(2)!.deliveredAt, null, "no rows stamped when unconfigured");
});

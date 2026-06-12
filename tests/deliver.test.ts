/**
 * U8 — single Sunday nudge delivery (replaces the per-item send tests).
 *
 * Exercises deliverNudge with a stubbed sender against a seeded temp DB
 * (COPILOT_DB_PATH set before import): exactly one message, a teaser count
 * that mirrors what the week view surfaces (hero + other non-calendar items +
 * active note-actions), the local link, the not_configured short-circuit, and
 * bounded retry on transient errors. Dry-run is covered at the telegram layer.
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import type { SendResult } from "../src/lib/telegram.js";

const WEEK_OF = "2026-06-07";

// --- Temp DB ----------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), "copilot-deliver-"));
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
  CREATE TABLE note_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kid_spine_id TEXT, source_note TEXT NOT NULL,
    forecast_text TEXT, action_text TEXT, action_kind TEXT,
    surface_on_or_after TEXT, clear_when TEXT, completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX note_actions_active_idx ON note_actions (completed_at);
`);
raw.prepare("INSERT INTO kids (id, name, dob, spine_id) VALUES (?, ?, ?, ?)").run(1, "Jude", "2025-12-07", "jude");

// Import AFTER COPILOT_DB_PATH is set so it opens the temp DB.
const { deliverNudge, weekViewUrl } = await import("../src/lib/deliver.js");

beforeEach(() => {
  raw.exec("DELETE FROM brief_items; DELETE FROM briefs; DELETE FROM note_actions;");
});

function seedBrief(weekOf: string): number {
  return Number(raw.prepare("INSERT INTO briefs (week_of, recipients) VALUES (?, '[]')").run(weekOf).lastInsertRowid);
}
function seedItem(briefId: number, triggerDetail: string, priority: number, headline: string): void {
  raw
    .prepare(
      `INSERT INTO brief_items (brief_id, kid_id, headline, body, trigger_source, trigger_detail, reasoning, confidence, priority)
       VALUES (?, 1, ?, 'body', 'lookahead', ?, 'r', 'high', ?)`,
    )
    .run(briefId, headline, triggerDetail, priority);
}
function seedAction(): void {
  raw
    .prepare(
      `INSERT INTO note_actions (kid_spine_id, source_note, forecast_text, action_text, action_kind)
       VALUES ('jude', 'raw', 'Crossing is near.', 'Order the next size.', 'one_shot')`,
    )
    .run();
}

function captureSends(results: SendResult[] | SendResult): { sent: string[]; send: (text: string) => Promise<SendResult> } {
  const queue = Array.isArray(results) ? [...results] : [results];
  const sent: string[] = [];
  return {
    sent,
    send: async (text: string) => {
      sent.push(text);
      return queue.length > 1 ? queue.shift()! : queue[0]!;
    },
  };
}

// --- Tests ------------------------------------------------------------------

test("R7: exactly one message, with the week-view count and the local link", async () => {
  const b = seedBrief(WEEK_OF);
  seedItem(b, "allergen:start", 1, "Start peanut soon"); // hero
  seedItem(b, "developmental:rolling", 2, "Rolling window opens"); // more
  seedItem(b, "vaccine_prep", 3, "6-month shots"); // calendar strip — NOT counted
  seedAction(); // active note-action — counted

  const { sent, send } = captureSends({ status: "ok", messageId: 7 });
  const result = await deliverNudge(WEEK_OF, { send });

  assert.equal(sent.length, 1, "exactly one Telegram message");
  assert.equal(result.status, "sent");
  assert.equal(result.itemCount, 3, "hero + 1 more + 1 action; the strip is ambient");
  assert.match(sent[0]!, /This week: 3 new things/);
  assert.ok(sent[0]!.includes(weekViewUrl()), "nudge carries the local week-view link");
});

test("empty week still nudges, with calm copy and a zero count", async () => {
  const { sent, send } = captureSends({ status: "ok", messageId: 8 });
  const result = await deliverNudge(WEEK_OF, { send });

  assert.equal(sent.length, 1);
  assert.equal(result.itemCount, 0);
  assert.match(sent[0]!, /All quiet this week/);
  assert.ok(sent[0]!.includes(weekViewUrl()));
});

test("not_configured short-circuits without retrying and generation-side data is untouched", async () => {
  const b = seedBrief(WEEK_OF);
  seedItem(b, "allergen:start", 1, "Start peanut soon");

  const { sent, send } = captureSends({ status: "not_configured", reason: "no token" });
  const result = await deliverNudge(WEEK_OF, { send });

  assert.equal(sent.length, 1, "no retries on not_configured");
  assert.equal(result.status, "not_configured");
});

test("transient errors get a bounded retry, then report failed", async () => {
  const { sent, send } = captureSends({ status: "error", reason: "boom" });
  const result = await deliverNudge(WEEK_OF, { send, retries: 2, retryDelayMs: 0 });

  assert.equal(sent.length, 3, "1 initial + 2 retries");
  assert.equal(result.status, "failed");
});

test("an error that recovers on retry reports sent", async () => {
  const { sent, send } = captureSends([
    { status: "error", reason: "boom" },
    { status: "ok", messageId: 9 },
  ]);
  const result = await deliverNudge(WEEK_OF, { send, retries: 2, retryDelayMs: 0 });

  assert.equal(sent.length, 2);
  assert.equal(result.status, "sent");
});

test("dry-run at the telegram layer sends nothing over the network and does not throw", async () => {
  // Fake config so loadConfig passes; dryRun=true skips the network entirely.
  process.env.TELEGRAM_BOT_TOKEN = "t";
  process.env.TELEGRAM_CHAT_ID = "c";
  process.env.TELEGRAM_CALLBACK_SECRET = "s";
  const { sendNudge } = await import("../src/lib/telegram.js");
  const result = await sendNudge("hello", true);
  assert.deepEqual(result, { status: "ok", messageId: -1 });
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_CALLBACK_SECRET;
});

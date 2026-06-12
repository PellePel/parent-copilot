/**
 * U4 — hand-rolled web server + SSR week view.
 *
 * Boots the request handler on an ephemeral port against a seeded temp DB and
 * asserts the rendered HTML. COPILOT_DB_PATH is set before importing the server
 * (db connection caches at load).
 */

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import Database from "better-sqlite3";

const AS_OF = "2026-05-10";

const dir = mkdtempSync(join(tmpdir(), "copilot-web-"));
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

const { createWebServer } = await import("../src/lib/web/server.js");

let server: Server;
let base: string;

before(async () => {
  server = createWebServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

beforeEach(() => {
  raw.exec("DELETE FROM brief_items; DELETE FROM briefs;");
});

function seedBrief(weekOf: string): number {
  return Number(raw.prepare("INSERT INTO briefs (week_of, recipients) VALUES (?, ?)").run(weekOf, "[]").lastInsertRowid);
}
function seedItem(briefId: number, triggerDetail: string, priority: number, headline: string, kidId: number | null = 1): void {
  raw
    .prepare(
      `INSERT INTO brief_items (brief_id, kid_id, headline, body, trigger_source, trigger_detail, reasoning, confidence, priority, cited_record)
       VALUES (?, ?, ?, ?, 'lookahead', ?, 'r', 'high', ?, ?)`,
    )
    .run(briefId, kidId, headline, "the body text", triggerDetail, priority, JSON.stringify({ kidSpineId: "jude", path: "x" }));
}

test("GET / renders 200 with the hero headline and the events strip", async () => {
  const b = seedBrief(AS_OF);
  seedItem(b, "allergen:start", 2, "Start peanut soon");
  seedItem(b, "vaccine_prep", 1, "6-month shots");

  const res = await fetch(`${base}/?asOf=${AS_OF}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const html = await res.text();
  assert.match(html, /Start peanut soon/);
  // The hero region carries the non-calendar item.
  assert.match(html, /class="hero"[\s\S]*Start peanut soon/);
  // The calendar item is in the strip, not the hero.
  assert.match(html, /On the calendar[\s\S]*6-month shots/);
});

test("empty week → 200 with calm empty-state, not an error", async () => {
  const res = await fetch(`${base}/?asOf=${AS_OF}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Nothing new to flag/);
});

test("unknown path → 404", async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
});

test("user/LLM content is HTML-escaped", async () => {
  const b = seedBrief(AS_OF);
  seedItem(b, "developmental:x", 1, "<script>alert(1)</script>");
  const res = await fetch(`${base}/?asOf=${AS_OF}`);
  const html = await res.text();
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

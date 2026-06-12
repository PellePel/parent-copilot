/**
 * U7 — selective "done?" tracking for one-shot note actions.
 *
 * Boots the real server against a seeded temp DB (COPILOT_DB_PATH set before
 * import). Done is a privilege of one_shot actions only: ambient rows render no
 * control and the endpoint refuses them; completed rows drop out of the view.
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

const dir = mkdtempSync(join(tmpdir(), "copilot-done-"));
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
  raw.close();
});

beforeEach(() => {
  raw.exec("DELETE FROM note_actions;");
});

function seedAction(kind: "one_shot" | "ambient", forecast: string, action: string): number {
  return Number(
    raw
      .prepare(
        `INSERT INTO note_actions (kid_spine_id, source_note, forecast_text, action_text, action_kind)
         VALUES ('jude', 'raw note', ?, ?, ?)`,
      )
      .run(forecast, action, kind).lastInsertRowid,
  );
}

function postDone(noteActionId: unknown): Promise<Response> {
  return fetch(`${base}/done`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ noteActionId }),
  });
}

test("R10: done on a one-shot sets completed_at and the action disappears from the next render", async () => {
  const id = seedAction("one_shot", "Sleep sack crossing is near.", "Order the next size.");

  let html = await (await fetch(`${base}/?asOf=${AS_OF}`)).text();
  assert.match(html, /Order the next size\./);

  const res = await postDone(id);
  assert.equal(res.status, 200);
  const row = raw.prepare("SELECT completed_at FROM note_actions WHERE id = ?").get(id) as { completed_at: string | null };
  assert.notEqual(row.completed_at, null);

  html = await (await fetch(`${base}/?asOf=${AS_OF}`)).text();
  assert.doesNotMatch(html, /Order the next size\./);
});

test("ambient actions expose no done control and the endpoint refuses them", async () => {
  const id = seedAction("ambient", "Swings are a reliable joy.", "Build in a swing stop.");

  const html = await (await fetch(`${base}/?asOf=${AS_OF}`)).text();
  assert.match(html, /Build in a swing stop\./);
  assert.doesNotMatch(html, new RegExp(`data-done="${id}"`));

  const res = await postDone(id);
  assert.equal(res.status, 400);
  const row = raw.prepare("SELECT completed_at FROM note_actions WHERE id = ?").get(id) as { completed_at: string | null };
  assert.equal(row.completed_at, null);
});

test("one-shot actions render a done control", async () => {
  const id = seedAction("one_shot", "Crossing is near.", "Order it.");
  const html = await (await fetch(`${base}/?asOf=${AS_OF}`)).text();
  assert.match(html, new RegExp(`data-done="${id}"`));
});

test("idempotent: marking an already-done action again is a no-op, not an error", async () => {
  const id = seedAction("one_shot", "Crossing is near.", "Order it.");
  await postDone(id);
  const first = raw.prepare("SELECT completed_at FROM note_actions WHERE id = ?").get(id) as { completed_at: string };

  const res = await postDone(id);
  assert.equal(res.status, 200);
  const payload = (await res.json()) as { ok: boolean; alreadyDone?: boolean };
  assert.equal(payload.ok, true);
  assert.equal(payload.alreadyDone, true);

  const second = raw.prepare("SELECT completed_at FROM note_actions WHERE id = ?").get(id) as { completed_at: string };
  assert.equal(second.completed_at, first.completed_at, "timestamp must not be rewritten");
});

test("unknown noteActionId → 404, no mutation; non-integer → 400", async () => {
  assert.equal((await postDone(99999)).status, 404);
  assert.equal((await postDone("nope")).status, 400);
});

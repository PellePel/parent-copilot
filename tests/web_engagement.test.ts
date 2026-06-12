/**
 * U5 — web engagement endpoints (reactions + correction).
 *
 * Boots the server on an ephemeral port against a seeded temp DB. Reactions
 * reuse applyReaction/applyCorrection (no HMAC). The correction LLM path is NOT
 * exercised here — applyCorrection short-circuits to "parked" for a non-pending
 * reaction, so the wiring + first-write-wins guard are tested without a network
 * call (the LLM-applied path is covered in correct.test.ts).
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

const dir = mkdtempSync(join(tmpdir(), "copilot-webx-"));
const dbPath = join(dir, "test.db");
process.env.COPILOT_DB_PATH = dbPath;

const raw = new Database(dbPath);
raw.exec(`
  CREATE TABLE kids (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, dob TEXT NOT NULL,
    pediatrician TEXT, daycare TEXT, notes TEXT, spine_id TEXT, created_at TEXT
  );
  CREATE TABLE measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kid_id INTEGER NOT NULL, type TEXT NOT NULL,
    value REAL NOT NULL, unit TEXT NOT NULL, measured_on TEXT NOT NULL, source TEXT, created_at TEXT
  );
  CREATE TABLE briefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, generated_at TEXT, week_of TEXT NOT NULL, recipients TEXT NOT NULL
  );
  CREATE TABLE brief_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, brief_id INTEGER NOT NULL, kid_id INTEGER,
    headline TEXT NOT NULL, body TEXT NOT NULL, suggested_action TEXT,
    trigger_source TEXT NOT NULL, trigger_detail TEXT, reasoning TEXT NOT NULL,
    confidence TEXT NOT NULL, priority INTEGER NOT NULL, related_to_current_edge TEXT,
    telegram_message_id INTEGER, delivered_at TEXT, cited_record TEXT, fact_target TEXT
  );
  CREATE TABLE reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, brief_item_id INTEGER NOT NULL, reaction TEXT NOT NULL,
    telegram_callback_id TEXT, prompt_message_id INTEGER, reply_message_id INTEGER,
    correction_text TEXT, applied_status TEXT NOT NULL DEFAULT 'n/a', created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE suppressions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kid_spine_id TEXT NOT NULL, trigger_detail TEXT NOT NULL,
    revalidation_kind TEXT NOT NULL, revalidation_params TEXT, source_reaction_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE quarantines (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kid_spine_id TEXT NOT NULL, record_path TEXT NOT NULL,
    reason TEXT, active INTEGER NOT NULL DEFAULT 1, lifted_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE factual_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT, brief_item_id INTEGER NOT NULL, kid_spine_id TEXT NOT NULL,
    cited_record TEXT, resolved_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE delight_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, brief_item_id INTEGER NOT NULL, kid_spine_id TEXT NOT NULL,
    trigger_detail TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);
raw.prepare("INSERT INTO kids (id, name, dob, spine_id) VALUES (?, ?, ?, ?)").run(1, "Jude", "2025-12-07", "jude");
raw.prepare("INSERT INTO measurements (kid_id, type, value, unit, measured_on) VALUES (1,'weight_kg',7.7,'kg',?)").run(AS_OF);

const { createWebServer } = await import("../src/lib/web/server.js");

let server: Server;
let base: string;

before(async () => {
  server = createWebServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

beforeEach(() => {
  raw.exec("DELETE FROM brief_items; DELETE FROM briefs; DELETE FROM reactions; DELETE FROM suppressions; DELETE FROM quarantines; DELETE FROM factual_errors; DELETE FROM delight_candidates;");
});

/** Seed one brief_item; returns its id. */
function seedItem(triggerDetail: string, kidId: number | null, citedRecord: object): number {
  const b = raw.prepare("INSERT INTO briefs (week_of, recipients) VALUES (?, '[]')").run(AS_OF).lastInsertRowid;
  return Number(
    raw
      .prepare(
        `INSERT INTO brief_items (brief_id, kid_id, headline, body, trigger_source, trigger_detail, reasoning, confidence, priority, cited_record)
         VALUES (?, ?, 'h', 'b', 'lookahead', ?, 'why it fired', 'high', 1, ?)`,
      )
      .run(b, kidId, triggerDetail, JSON.stringify(citedRecord)).lastInsertRowid,
  );
}

function post(path: string, payload: unknown): Promise<Response> {
  return fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function jbody(res: Response): Promise<any> {
  return res.json();
}
function count(sql: string, ...args: unknown[]): number {
  return (raw.prepare(sql).get(...(args as never[])) as { n: number }).n;
}
function scalar<T>(sql: string, ...args: unknown[]): T {
  return raw.prepare(sql).get(...(args as never[])) as T;
}

test("R6/R11: handled upserts a suppression and logs a delight candidate", async () => {
  const id = seedItem("outgrowing:sleep_sack", 1, { kidSpineId: "jude", path: "gear.sleep_sack" });
  const res = await post("/react", { briefItemId: id, reaction: "handled", nonce: "n1" });
  const body = await jbody(res);
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(count("SELECT count(*) n FROM suppressions WHERE trigger_detail='outgrowing:sleep_sack'"), 1);
  assert.equal(count("SELECT count(*) n FROM delight_candidates"), 1);
});

test("already_knew suppresses without a delight row", async () => {
  const id = seedItem("outgrowing:sleep_sack", 1, { kidSpineId: "jude", path: "gear.sleep_sack" });
  await post("/react", { briefItemId: id, reaction: "already_knew", nonce: "n2" });
  assert.equal(count("SELECT count(*) n FROM suppressions"), 1);
  assert.equal(count("SELECT count(*) n FROM delight_candidates"), 0);
});

test("wrong quarantines the cited record and parks a pending correction", async () => {
  const id = seedItem("developmental:peekaboo", 1, { kidSpineId: "jude", path: "developmental.milestones[0]" });
  const res = await post("/react", { briefItemId: id, reaction: "wrong", nonce: "n3" });
  const body = await jbody(res);
  assert.equal(body.kind, "quarantined");
  assert.equal(count("SELECT count(*) n FROM quarantines WHERE active=1"), 1);
  assert.equal(count("SELECT count(*) n FROM factual_errors"), 1);
  assert.equal(scalar<{ s: string }>("SELECT applied_status s FROM reactions WHERE id=?", body.reactionId).s, "pending");
});

test("idempotency: same nonce applies once", async () => {
  const id = seedItem("outgrowing:sleep_sack", 1, { kidSpineId: "jude", path: "gear.sleep_sack" });
  await post("/react", { briefItemId: id, reaction: "handled", nonce: "dup" });
  const res2 = await post("/react", { briefItemId: id, reaction: "handled", nonce: "dup" });
  const body2 = await jbody(res2);
  assert.equal(body2.kind, "noop_duplicate");
  assert.equal(count("SELECT count(*) n FROM suppressions"), 1, "no double-apply");
});

test("family-level wrong is logged but not quarantined", async () => {
  const id = seedItem("crossproduct:travel", null, { kidSpineId: "family", path: "x" });
  const res = await post("/react", { briefItemId: id, reaction: "wrong", nonce: "n4" });
  const body = await jbody(res);
  assert.equal(body.kind, "fact_updated");
  assert.equal(count("SELECT count(*) n FROM quarantines"), 0);
  assert.equal(count("SELECT count(*) n FROM factual_errors"), 1);
});

test("invalid reaction → 400; unknown brief item → 400", async () => {
  const id = seedItem("outgrowing:sleep_sack", 1, { kidSpineId: "jude", path: "gear.sleep_sack" });
  assert.equal((await post("/react", { briefItemId: id, reaction: "bogus", nonce: "n5" })).status, 400);
  assert.equal((await post("/react", { briefItemId: 99999, reaction: "handled", nonce: "n6" })).status, 400);
});

test("/correct wires text through and enforces first-write-wins", async () => {
  // A reaction in 'n/a' status → applyCorrection short-circuits to parked (no LLM).
  const id = seedItem("developmental:peekaboo", 1, { kidSpineId: "jude", path: "developmental.milestones[0]" });
  const rid = Number(
    raw.prepare("INSERT INTO reactions (brief_item_id, reaction, applied_status) VALUES (?, 'wrong', 'n/a')").run(id).lastInsertRowid,
  );
  const r1 = await post("/correct", { reactionId: rid, text: "She has done peekaboo for weeks" });
  assert.equal(r1.status, 200);
  assert.equal(scalar<{ t: string }>("SELECT correction_text t FROM reactions WHERE id=?", rid).t, "She has done peekaboo for weeks");

  const r2 = await post("/correct", { reactionId: rid, text: "second attempt" });
  assert.equal(r2.status, 409, "first-write-wins");

  assert.equal((await post("/correct", { reactionId: rid, text: "" })).status, 400, "empty text rejected");
});

/**
 * U6 — note → forecast → action pipeline.
 *
 * Same shared-temp-DB discipline as gear_threshold.test.ts: COPILOT_DB_PATH is
 * set once before importing anything that touches db/index.ts, the schema is
 * hand-rolled through a raw handle, and rows are reset between tests. The LLM
 * is replaced with an injectable fake client (mirroring correct.ts tests) so
 * derivation runs without a network call; the AE2 timing assertions compute
 * their expectation through the same public KB helpers the pipeline uses.
 */

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import Database from "better-sqlite3";

import { lbToKg } from "../src/lib/kb/gear.js";
import { weeksUntilTargetWeight } from "../src/lib/kb/outgrowing.js";
import { ageInMonths } from "../src/lib/age.js";
import type { NoteClient } from "../src/lib/note_action.js";

const DOB = "2025-12-07"; // Jude — ~5mo at AS_OF
const AS_OF = "2026-05-10";

const dir = mkdtempSync(join(tmpdir(), "copilot-note-"));
const dbPath = join(dir, "test.db");
process.env.COPILOT_DB_PATH = dbPath;
delete process.env.ANTHROPIC_API_KEY; // the no-client path must degrade gracefully

const raw = new Database(dbPath);
raw.exec(`
  CREATE TABLE kids (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, dob TEXT NOT NULL,
    pediatrician TEXT, daycare TEXT, notes TEXT, spine_id TEXT, created_at TEXT
  );
  CREATE TABLE measurements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kid_id INTEGER NOT NULL, type TEXT NOT NULL, value REAL NOT NULL,
    unit TEXT NOT NULL, measured_on TEXT NOT NULL, source TEXT, created_at TEXT
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
raw.prepare("INSERT INTO kids (id, name, dob, spine_id) VALUES (?, ?, ?, ?)").run(1, "Jude", DOB, "jude");

const { recordNote, deriveNoteAction, getActiveNoteActions } = await import("../src/lib/note_action.js");
const { createWebServer } = await import("../src/lib/web/server.js");

beforeEach(() => {
  raw.exec("DELETE FROM note_actions; DELETE FROM measurements;");
});

function insertWeight(valueKg: number, measuredOn: string): void {
  raw
    .prepare("INSERT INTO measurements (kid_id, type, value, unit, measured_on) VALUES (?, ?, ?, ?, ?)")
    .run(1, "weight_kg", valueKg, "kg", measuredOn);
}

type RawRow = {
  source_note: string;
  forecast_text: string | null;
  action_text: string | null;
  action_kind: string | null;
  surface_on_or_after: string | null;
  clear_when: string | null;
  completed_at: string | null;
};

function rowById(id: number): RawRow {
  return raw.prepare("SELECT * FROM note_actions WHERE id = ?").get(id) as RawRow;
}

function fakeClient(
  input: Record<string, unknown>,
  opts: { fail?: boolean; delayMs?: number } = {},
): NoteClient {
  return {
    messages: {
      create: async () => {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        if (opts.fail) throw new Error("synthetic API failure");
        return {
          content: [{ type: "tool_use", id: "t1", name: "submit_note_action", input }],
        } as never;
      },
    },
  };
}

const SLEEP_SACK_DERIVATION = {
  forecastText: "Jude will outgrow the current sleep sack around the 18 lb mark.",
  actionText: "Order the next sleep sack size.",
  weightThresholdLb: 18,
};

function addWeeksIso(iso: string, weeks: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(weeks * 7));
  return d.toISOString().slice(0, 10);
}

test("AE2: weight-keyed note derives a one-shot with surface date ≈ crossing − 2wk and a clear band", async () => {
  insertWeight(lbToKg(15), "2026-05-08"); // well below 18 lb so the crossing is >2 weeks out
  const id = recordNote("bigger sleep sack at 18 lb", "jude");

  const result = await deriveNoteAction(id, { client: fakeClient(SLEEP_SACK_DERIVATION), asOf: AS_OF });
  assert.equal(result.status, "derived");

  const row = rowById(id);
  assert.equal(row.action_kind, "one_shot");
  assert.deepEqual(JSON.parse(row.clear_when!), { type: "weight_kg", value: lbToKg(18) });

  // Expectation computed through the same public helpers the pipeline uses.
  const weeks = weeksUntilTargetWeight(lbToKg(15), ageInMonths(DOB, AS_OF), lbToKg(18));
  assert.ok(weeks !== null && weeks > 2, `precondition: crossing must be >2 weeks out (got ${weeks})`);
  assert.equal(row.surface_on_or_after, addWeeksIso(AS_OF, weeks - 2));

  // Held until the surface date arrives, then surfaced.
  assert.equal(getActiveNoteActions(AS_OF).length, 0);
  const surfaced = getActiveNoteActions(row.surface_on_or_after!);
  assert.equal(surfaced.length, 1);
  assert.equal(surfaced[0]!.actionKind, "one_shot");
});

test("AE2 auto-clear: a measurement crossing the band stops surfacing the action", async () => {
  insertWeight(lbToKg(17.6), "2026-05-08"); // close → surfaces immediately (≤2wk to crossing)
  const id = recordNote("bigger sleep sack at 18 lb", "jude");
  await deriveNoteAction(id, { client: fakeClient(SLEEP_SACK_DERIVATION), asOf: AS_OF });

  assert.equal(getActiveNoteActions(AS_OF).length, 1);

  insertWeight(lbToKg(18.3), "2026-05-20"); // crossed
  const after = getActiveNoteActions("2026-05-21");
  assert.equal(after.length, 0, "crossed band must auto-clear without a done tap");
  assert.equal(rowById(id).completed_at, null, "auto-clear is band-driven, not completion");
});

test("R8: the surfaced item is the derived forecast+action, never the raw note verbatim", async () => {
  const noteText = "grandma visiting June, Jude naps badly when routine changes";
  const id = recordNote(noteText, "jude");
  await deriveNoteAction(id, {
    client: fakeClient({
      forecastText: "Expect rockier naps while the routine shifts during the June visit.",
      actionText: "Protect the morning nap window during the visit.",
    }),
    asOf: AS_OF,
  });

  const surfaced = getActiveNoteActions(AS_OF);
  assert.equal(surfaced.length, 1);
  assert.notEqual(surfaced[0]!.forecastText, noteText);
  assert.ok(!surfaced[0]!.forecastText.includes(noteText));
  assert.ok(!("sourceNote" in surfaced[0]!), "the view never carries the raw note");
});

test("ambient note: no weight key → ambient kind, no date/band, appears immediately", async () => {
  const id = recordNote("Jude lights up at the playground swings", "jude");
  await deriveNoteAction(id, {
    client: fakeClient({
      forecastText: "Swings are a reliable joy right now.",
      actionText: "Build a swing stop into the Saturday walk.",
    }),
    asOf: AS_OF,
  });

  const row = rowById(id);
  assert.equal(row.action_kind, "ambient");
  assert.equal(row.surface_on_or_after, null);
  assert.equal(row.clear_when, null);
  assert.equal(getActiveNoteActions(AS_OF).length, 1);
});

test("family-level weight-keyed note degrades to ambient (no kid to project)", async () => {
  const id = recordNote("bigger sleep sack at 18 lb", null);
  await deriveNoteAction(id, { client: fakeClient(SLEEP_SACK_DERIVATION), asOf: AS_OF });
  const row = rowById(id);
  assert.equal(row.action_kind, "ambient");
  assert.equal(row.surface_on_or_after, null);
});

test("the hot path is not blocked: the raw note persists before derivation completes", async () => {
  const id = recordNote("bigger sleep sack at 18 lb", "jude");
  assert.equal(rowById(id).source_note, "bigger sleep sack at 18 lb");
  assert.equal(rowById(id).forecast_text, null);

  insertWeight(lbToKg(17), "2026-05-08");
  const pending = deriveNoteAction(id, {
    client: fakeClient(SLEEP_SACK_DERIVATION, { delayMs: 50 }),
    asOf: AS_OF,
  });
  assert.equal(rowById(id).forecast_text, null, "derivation is async; the row is not yet enriched");
  await pending;
  assert.notEqual(rowById(id).forecast_text, null);
});

test("derivation failure leaves the raw note intact and surfaces nothing broken", async () => {
  const id = recordNote("bigger sleep sack at 18 lb", "jude");
  const result = await deriveNoteAction(id, { client: fakeClient({}, { fail: true }), asOf: AS_OF });
  assert.equal(result.status, "skipped");

  const row = rowById(id);
  assert.equal(row.source_note, "bigger sleep sack at 18 lb");
  assert.equal(row.forecast_text, null);
  assert.equal(getActiveNoteActions(AS_OF).length, 0, "underived rows never surface");
});

test("deriveNoteAction on a missing row id is a skip, not a crash", async () => {
  const result = await deriveNoteAction(99999, { client: fakeClient(SLEEP_SACK_DERIVATION), asOf: AS_OF });
  assert.equal(result.status, "skipped");
});

// --- POST /note over the real server -----------------------------------------

let server: Server;
let base: string;

test("POST /note returns promptly with the row id; missing API key degrades gracefully", async (t) => {
  server = createWebServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  t.after(() => server.close());

  const res = await fetch(`${base}/note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "swim lessons start mid-July", kidSpineId: "jude" }),
  });
  assert.equal(res.status, 202);
  const payload = (await res.json()) as { ok: boolean; noteActionId: number };
  assert.equal(payload.ok, true);

  const row = rowById(payload.noteActionId);
  assert.equal(row.source_note, "swim lessons start mid-July");
  // No ANTHROPIC_API_KEY in the test env → derivation skips; the note survives.
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(rowById(payload.noteActionId).forecast_text, null);

  const empty = await fetch(`${base}/note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "   " }),
  });
  assert.equal(empty.status, 400);
});

after(() => {
  raw.close();
});

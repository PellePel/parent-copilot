/**
 * U2 — Spine mutator + quarantine helper tests.
 *
 * Spine mutators run against a temp copy of family_context.example.json so the
 * real data/ file is never touched. Quarantine helpers run against a temp DB
 * (COPILOT_DB_PATH + minimal DDL, mirroring tests/citation.test.ts), imported
 * AFTER the env var is set so db/index.ts opens the temp file.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { loadFamilyContext } from "../src/lib/context.js";
import {
  markAllergenIntroduced,
  clearMilestone,
  addThingWeAlreadyKnow,
  advanceWellVisitDue,
  applySpineDiff,
  mutateSpine,
} from "../src/lib/spine_write.js";

const EXAMPLE = "./data/family_context.example.json";
const KID = "kid_a"; // the example file's single kid id

/** Copy the example spine into a fresh temp file and return its path. */
function tempSpine(): string {
  const dir = mkdtempSync(join(tmpdir(), "copilot-spine-"));
  const path = join(dir, "family_context.json");
  copyFileSync(EXAMPLE, path);
  return path;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function kidOf(path: string, id: string): Record<string, unknown> {
  const root = readJson(path);
  const kids = root["kids"] as Array<Record<string, unknown>>;
  return kids.find((k) => k["id"] === id)!;
}

// --- Spine mutator tests ---------------------------------------------------

test("markAllergenIntroduced moves between arrays; file still loads", async () => {
  const path = tempSpine();
  await markAllergenIntroduced(KID, "peanut", path);

  const status = (
    (kidOf(path, KID)["patterns"] as Record<string, unknown>)["eating"] as Record<string, unknown>
  )["allergen_introduction_status"] as Record<string, unknown>;
  assert.deepEqual(status["introduced"], ["peanut"]);
  assert.ok(!(status["not_yet_introduced"] as string[]).includes("peanut"));

  const loaded = loadFamilyContext(path);
  assert.equal(loaded.status, "ok");
});

test("markAllergenIntroduced is idempotent (no dup, no-op when introduced)", async () => {
  const path = tempSpine();
  await markAllergenIntroduced(KID, "egg", path);
  await markAllergenIntroduced(KID, "egg", path);

  const status = (
    (kidOf(path, KID)["patterns"] as Record<string, unknown>)["eating"] as Record<string, unknown>
  )["allergen_introduction_status"] as Record<string, unknown>;
  assert.deepEqual(status["introduced"], ["egg"]);
});

test("unknown/loose fields elsewhere survive a write", async () => {
  const path = tempSpine();
  // Inject a loose field that no schema knows about.
  const root = readJson(path);
  (root["kids"] as Array<Record<string, unknown>>)[0]!["totally_unknown_field"] = {
    keep: "me",
    nested: [1, 2, 3],
  };
  root["another_root_extra"] = "preserve";
  writeFileSync(path, JSON.stringify(root, null, 2), "utf8");

  await markAllergenIntroduced(KID, "soy", path);

  const after = readJson(path);
  assert.deepEqual((after["kids"] as Array<Record<string, unknown>>)[0]!["totally_unknown_field"], {
    keep: "me",
    nested: [1, 2, 3],
  });
  assert.equal(after["another_root_extra"], "preserve");
});

test("clearMilestone sets matching milestone status to cleared", async () => {
  const path = tempSpine();
  await clearMilestone(KID, "simple_sentences_3_4_words", path);

  const dev = kidOf(path, KID)["developmental"] as Record<string, unknown>;
  const milestones = dev["milestones"] as Array<Record<string, unknown>>;
  const m = milestones.find((x) => x["milestone"] === "simple_sentences_3_4_words")!;
  assert.equal(m["status"], "cleared");
});

test("addThingWeAlreadyKnow is idempotent", async () => {
  const path = tempSpine();
  await addThingWeAlreadyKnow(KID, "potty_training_started", path);
  await addThingWeAlreadyKnow(KID, "potty_training_started", path);

  const dev = kidOf(path, KID)["developmental"] as Record<string, unknown>;
  const list = dev["things_we_already_know"] as string[];
  assert.equal(list.filter((x) => x === "potty_training_started").length, 1);
});

test("advanceWellVisitDue writes the canonical absence-engine path", async () => {
  const path = tempSpine();
  await advanceWellVisitDue(KID, "2026-09-01", path);

  const medical = kidOf(path, KID)["medical"] as Record<string, unknown>;
  const next = medical["next_well_visit"] as Record<string, unknown>;
  // Must match what engine/absence.ts reads: medical.next_well_visit.date
  assert.equal(next["date"], "2026-09-01");
});

test("a mutation producing an invalid spine is rejected; original intact", async () => {
  const path = tempSpine();
  const before = readFileSync(path, "utf8");

  // Remove the only kid → fails FamilyContextSchema (kids must have >=1).
  await assert.rejects(
    mutateSpine(KID, path, (root) => {
      root["kids"] = [];
    }),
    /invalid spine/,
  );

  assert.equal(readFileSync(path, "utf8"), before, "original must be untouched");
});

test("applySpineDiff sets a kid-relative path", async () => {
  const path = tempSpine();
  await applySpineDiff(KID, "patterns.eating.schedule", "3 meals + 2 snacks", path);

  const eating = (kidOf(path, KID)["patterns"] as Record<string, unknown>)["eating"] as Record<
    string,
    unknown
  >;
  assert.equal(eating["schedule"], "3 meals + 2 snacks");
});

test("applySpineDiff rejects an out-of-subtree (root key) path", async () => {
  const path = tempSpine();
  await assert.rejects(
    applySpineDiff(KID, "family.location.city", "Evil", path),
    /escapes kid|kids\[/,
  );
  await assert.rejects(applySpineDiff(KID, "kids[1].name", "Other", path), /kids\[/);
});

test("two interleaved RMW cycles both land (lock works, no lost update)", async () => {
  const path = tempSpine();
  await Promise.all([
    markAllergenIntroduced(KID, "peanut", path),
    addThingWeAlreadyKnow(KID, "lock_test_entry", path),
  ]);

  const kid = kidOf(path, KID);
  const status = (
    (kid["patterns"] as Record<string, unknown>)["eating"] as Record<string, unknown>
  )["allergen_introduction_status"] as Record<string, unknown>;
  const dev = kid["developmental"] as Record<string, unknown>;

  assert.ok((status["introduced"] as string[]).includes("peanut"), "allergen write landed");
  assert.ok(
    (dev["things_we_already_know"] as string[]).includes("lock_test_entry"),
    "things-we-know write landed",
  );

  const loaded = loadFamilyContext(path);
  assert.equal(loaded.status, "ok");
});

// --- Quarantine helper tests (temp DB) -------------------------------------

test("quarantine helpers: insert (idempotent), lift, activeQuarantines", async () => {
  const dir = mkdtempSync(join(tmpdir(), "copilot-quar-"));
  const dbPath = join(dir, "test.db");
  process.env.COPILOT_DB_PATH = dbPath;

  const raw = new Database(dbPath);
  raw.exec(`
    CREATE TABLE quarantines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kid_spine_id TEXT NOT NULL,
      record_path TEXT NOT NULL,
      reason TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      lifted_at TEXT,
      created_at TEXT
    );
  `);
  raw.close();

  // Import AFTER COPILOT_DB_PATH is set so db/index.ts opens the temp DB.
  const { quarantineRecord, liftQuarantine, activeQuarantines } = await import(
    "../src/lib/spine_write.js"
  );

  quarantineRecord("kid_a", "medical.allergies[0]", "user said wrong");
  quarantineRecord("kid_a", "medical.allergies[0]", "dup attempt"); // idempotent no-op
  quarantineRecord("kid_a", "developmental.milestones[2]", "another");

  let active = activeQuarantines("kid_a");
  assert.equal(active.length, 2, "two distinct active quarantines, no dup");

  const target = active.find((q) => q.recordPath === "medical.allergies[0]")!;
  liftQuarantine(target.id);

  active = activeQuarantines("kid_a");
  assert.equal(active.length, 1, "one active after lifting");
  assert.equal(active[0]!.recordPath, "developmental.milestones[2]");

  // A re-quarantine of a lifted path becomes active again.
  quarantineRecord("kid_a", "medical.allergies[0]", "re-flag");
  assert.equal(activeQuarantines("kid_a").length, 2);
});

/**
 * U3 — signed callback data helpers.
 *
 * These are the security control on reactions: callback_data is otherwise
 * attacker-controllable, so a forged or tampered payload must fail
 * verification. All tests pass an explicit secret, so no env is needed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  signCallback,
  verifyCallback,
  REACTION_CODES,
  CODE_TO_REACTION,
} from "../src/lib/telegram.js";

const SECRET = "test-callback-secret-do-not-use-in-prod";

test("signCallback → verifyCallback round-trips for all four codes", () => {
  for (const code of REACTION_CODES) {
    const data = signCallback(42, code, SECRET);
    const result = verifyCallback(data, SECRET);
    assert.ok(result, `expected verify to succeed for code ${code}`);
    assert.equal(result.briefItemId, 42);
    assert.equal(result.code, code);
    assert.equal(result.reaction, CODE_TO_REACTION[code]);
  }
});

test("callback_data format is r:<id>:<code>:<sig>", () => {
  const data = signCallback(42, "handled", SECRET);
  const parts = data.split(":");
  assert.equal(parts.length, 4);
  assert.equal(parts[0], "r");
  assert.equal(parts[1], "42");
  assert.equal(parts[2], "handled");
  assert.ok(parts[3] && parts[3].length > 0);
});

test("tampered signature fails verification", () => {
  const data = signCallback(7, "wrong", SECRET);
  const parts = data.split(":");
  // Flip a char in the sig (keep length so it still parses to bytes).
  const sig = parts[3]!;
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${flipped}`;
  assert.equal(verifyCallback(tampered, SECRET), null);
});

test("tampered id fails verification", () => {
  const data = signCallback(7, "more", SECRET);
  const parts = data.split(":");
  const tampered = `${parts[0]}:8:${parts[2]}:${parts[3]}`;
  assert.equal(verifyCallback(tampered, SECRET), null);
});

test("tampered code fails verification", () => {
  const data = signCallback(7, "handled", SECRET);
  const parts = data.split(":");
  const tampered = `${parts[0]}:${parts[1]}:wrong:${parts[3]}`;
  assert.equal(verifyCallback(tampered, SECRET), null);
});

test("wrong secret fails verification", () => {
  const data = signCallback(7, "knew", SECRET);
  assert.equal(verifyCallback(data, "a-different-secret"), null);
});

test("malformed strings return null", () => {
  const cases = [
    "",
    "r",
    "r:42",
    "r:42:handled",
    "r:42:handled:sig:extra",
    "x:42:handled:sig", // bad prefix
    "r:notanum:handled:sig", // bad id
    "r:42:bogus:sig", // unknown code
    "r:-1:handled:sig", // negative id (regex rejects)
    "r:4.2:handled:sig", // float id
    "::handled:", // empties
  ];
  for (const c of cases) {
    assert.equal(verifyCallback(c, SECRET), null, `expected null for ${JSON.stringify(c)}`);
  }
});

test("signed payload byte length ≤ 64 for a large briefItemId", () => {
  for (const code of REACTION_CODES) {
    const data = signCallback(999999, code, SECRET);
    const bytes = Buffer.byteLength(data, "utf8");
    assert.ok(bytes <= 64, `callback_data ${bytes} bytes exceeds 64 for code ${code}`);
  }
});

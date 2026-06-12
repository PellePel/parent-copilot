/**
 * Web engagement handlers (U5) — reactions + correction.
 *
 * These reuse the transport-agnostic reaction libraries directly: the four
 * web controls map to the same `applyReaction` dispatch the Telegram buttons
 * used, and "wrong" corrections flow through `applyCorrection`. The Telegram
 * HMAC machinery is deliberately NOT ported — a local-only page acting on the
 * DB has no untrusted-callback problem. Web idempotency is provided by a
 * per-render nonce in place of the telegram callback id.
 */

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { IncomingMessage, ServerResponse } from "node:http";
import { db } from "../db/index.js";
import { reactions, noteActions, REACTION_KINDS, type ReactionKind } from "../db/schema.js";
import { applyReaction } from "../reactions.js";
import { applyCorrection } from "../correct.js";
import { recordNote, deriveNoteAction } from "../note_action.js";

const MAX_BODY_BYTES = 64 * 1024;

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
}

function isReactionKind(x: unknown): x is ReactionKind {
  return typeof x === "string" && (REACTION_KINDS as readonly string[]).includes(x);
}

/** POST /react { briefItemId, reaction, nonce? } */
export async function handleReact(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const briefItemId = Number(body.briefItemId);
  const reaction = body.reaction;
  if (!Number.isInteger(briefItemId) || !isReactionKind(reaction)) {
    return json(res, 400, { ok: false, error: "briefItemId (int) and valid reaction required" });
  }
  // Web idempotency key: client sends a per-render nonce; fall back to a fresh one.
  const nonce = typeof body.nonce === "string" && body.nonce.length > 0 ? body.nonce : `web:${randomUUID()}`;

  try {
    const result = await applyReaction(briefItemId, reaction, nonce);
    return json(res, 200, { ok: true, ...result });
  } catch (err) {
    console.error("handleReact error:", err);
    return json(res, 400, { ok: false, error: "could not apply reaction" });
  }
}

/**
 * POST /note { text, kidSpineId? } — persist the raw note and return
 * immediately; the LLM derivation runs off the hot path (KTD7). A derivation
 * failure leaves the raw note intact and surfaces nothing broken.
 */
export async function handleNote(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const kidSpineId = typeof body.kidSpineId === "string" && body.kidSpineId.length > 0 ? body.kidSpineId : null;
  if (text.length === 0) {
    return json(res, 400, { ok: false, error: "non-empty text required" });
  }

  const noteActionId = recordNote(text, kidSpineId);
  void deriveNoteAction(noteActionId).catch((err) => console.error("note derivation error:", err));
  return json(res, 202, { ok: true, noteActionId });
}

/**
 * POST /done { noteActionId } — selective completion (U7). Done is a privilege
 * granted to one_shot actions only; ambient actions never carry it. Idempotent:
 * marking an already-done action again is a no-op, not an error.
 */
export async function handleDone(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const noteActionId = Number(body.noteActionId);
  if (!Number.isInteger(noteActionId)) {
    return json(res, 400, { ok: false, error: "noteActionId (int) required" });
  }

  const row = db.select().from(noteActions).where(eq(noteActions.id, noteActionId)).get();
  if (!row) return json(res, 404, { ok: false, error: "no such note action" });
  if (row.actionKind !== "one_shot") {
    return json(res, 400, { ok: false, error: "only one_shot actions can be marked done" });
  }
  if (row.completedAt) return json(res, 200, { ok: true, alreadyDone: true });

  db.update(noteActions)
    .set({ completedAt: new Date().toISOString() })
    .where(eq(noteActions.id, noteActionId))
    .run();
  return json(res, 200, { ok: true });
}

/** POST /correct { reactionId, text } — first-write-wins, then apply. */
export async function handleCorrect(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  const reactionId = Number(body.reactionId);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!Number.isInteger(reactionId) || text.length === 0) {
    return json(res, 400, { ok: false, error: "reactionId (int) and non-empty text required" });
  }

  // First-write-wins: only set the correction if one isn't already captured.
  const updated = db
    .update(reactions)
    .set({ correctionText: text })
    .where(and(eq(reactions.id, reactionId), isNull(reactions.correctionText)))
    .run();
  if (updated.changes === 0) {
    return json(res, 409, { ok: false, error: "correction already captured or reaction missing" });
  }

  try {
    const result = await applyCorrection(reactionId);
    return json(res, 200, { ok: true, ...result });
  } catch (err) {
    console.error("handleCorrect error:", err);
    return json(res, 400, { ok: false, error: "could not apply correction" });
  }
}

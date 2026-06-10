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
import { reactions, REACTION_KINDS, type ReactionKind } from "../db/schema.js";
import { applyReaction } from "../reactions.js";
import { applyCorrection } from "../correct.js";

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

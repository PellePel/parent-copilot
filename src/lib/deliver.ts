/**
 * Brief delivery loop (U4).
 *
 * Sends each persisted brief item to Telegram and records delivery on the row.
 * Extracted from generate-brief.ts so it can be unit-tested with a stubbed
 * sender + temp DB (mirrors the calendar module's non-throwing, degrade-
 * gracefully posture).
 *
 * R4 — "not delivered until it reaches the channel": `deliveredAt` is only set
 * when a send succeeds. Failed sends leave it null and count as failed.
 */

import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { briefItems, type BriefItem } from "./db/schema.js";
import { sendItem as defaultSendItem, type SendResult } from "./telegram.js";
import { todayIso } from "./age.js";

export type DeliverResult = {
  delivered: number;
  failed: number;
  /** True when Telegram isn't configured — the whole step was skipped. */
  notConfigured: boolean;
};

export type DeliverOptions = {
  /** Injectable sender (defaults to telegram.sendItem). Lets tests stub the network. */
  send?: (item: BriefItem) => Promise<SendResult>;
  /** Per-item retry budget on transient `error` results. */
  retries?: number;
  /** Delay between retries, in ms. */
  retryDelayMs?: number;
};

const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deliver each item to Telegram. On success, stamp `telegramMessageId` +
 * `deliveredAt`. On a not_configured first send, skip the whole step. On
 * per-item errors, retry a bounded number of times before giving up; other
 * items still attempt delivery.
 */
export async function deliverBrief(
  items: BriefItem[],
  opts: DeliverOptions = {},
): Promise<DeliverResult> {
  const send = opts.send ?? defaultSendItem;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  let delivered = 0;
  let failed = 0;

  for (const item of items) {
    let result = await send(item);

    // Telegram unconfigured → skip delivery entirely (mirror calendar branch).
    if (result.status === "not_configured") {
      return { delivered, failed, notConfigured: true };
    }

    // Bounded retry on transient errors.
    for (let attempt = 0; result.status === "error" && attempt < retries; attempt++) {
      await sleep(retryDelayMs);
      result = await send(item);
      if (result.status === "not_configured") {
        return { delivered, failed, notConfigured: true };
      }
    }

    if (result.status === "ok") {
      db
        .update(briefItems)
        .set({ telegramMessageId: result.messageId, deliveredAt: todayIso() })
        .where(eq(briefItems.id, item.id))
        .run();
      delivered++;
    } else {
      // Still failing after retries — leave deliveredAt null (R4).
      failed++;
    }
  }

  return { delivered, failed, notConfigured: false };
}

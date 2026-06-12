/**
 * Sunday nudge delivery (U8) — the web-surface pivot.
 *
 * The seven-message brief send is gone: Telegram is now only the link-carrier
 * (provisional-until-PMF). After assembly we send ONE thin message — a teaser
 * with the count of newly surfaced things plus a link into the local week view.
 * The teaser count mirrors exactly what the page leads with (hero + the other
 * non-calendar items + active note-actions), not the old 7-item cap.
 *
 * Degrades gracefully: not-configured Telegram skips the nudge without failing
 * generation, and transient send errors get a bounded retry.
 */

import { buildWeekView } from "./engine/week_view.js";
import { getActiveNoteActions } from "./note_action.js";
import { sendNudge as defaultSendNudge, type SendResult } from "./telegram.js";
import { DEFAULT_WEB_PORT } from "./web/server.js";
import { todayIso } from "./age.js";

export type NudgeResult = {
  status: "sent" | "failed" | "not_configured";
  /** What the teaser counted: hero + other non-calendar items + active actions. */
  itemCount: number;
  url: string;
};

export type NudgeOptions = {
  /** Injectable sender (defaults to telegram.sendNudge). Lets tests stub the network. */
  send?: (text: string) => Promise<SendResult>;
  /** Retry budget on transient `error` results. */
  retries?: number;
  /** Delay between retries, in ms. */
  retryDelayMs?: number;
};

const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function weekViewUrl(): string {
  const port = process.env.COPILOT_WEB_PORT ?? DEFAULT_WEB_PORT;
  return `http://127.0.0.1:${port}/`;
}

function teaser(count: number): string {
  if (count === 0) return "All quiet this week — nothing new to flag.";
  return count === 1 ? "This week: 1 new thing worth a look." : `This week: ${count} new things worth a look.`;
}

/**
 * Send the single Sunday nudge linking into the week view. The count reflects
 * what the page actually surfaces for `asOf` (hero, the rest of the
 * non-calendar pool, and active note-actions — the calendar strip is ambient).
 */
export async function deliverNudge(
  asOf: string = todayIso(),
  opts: NudgeOptions = {},
): Promise<NudgeResult> {
  const send = opts.send ?? defaultSendNudge;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const wv = buildWeekView(asOf, { actions: getActiveNoteActions(asOf) });
  const itemCount = (wv.hero ? 1 : 0) + wv.more.length + wv.actions.length;
  const url = weekViewUrl();
  const text = `${teaser(itemCount)}\n${url}`;

  let result = await send(text);
  for (let attempt = 0; result.status === "error" && attempt < retries; attempt++) {
    await sleep(retryDelayMs);
    result = await send(text);
  }

  if (result.status === "not_configured") return { status: "not_configured", itemCount, url };
  if (result.status === "ok") return { status: "sent", itemCount, url };
  return { status: "failed", itemCount, url };
}

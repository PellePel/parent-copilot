/**
 * Telegram bot client + signed callback helpers.
 *
 * Delivery surface for the weekly brief. Mirrors the calendar module's
 * non-throwing status union so the brief degrades gracefully when the bot
 * isn't configured (instead of crashing).
 *
 * Config (env):
 *   TELEGRAM_BOT_TOKEN        — bot token from @BotFather. Required.
 *   TELEGRAM_CHAT_ID          — chat id messages are sent to. Required.
 *   TELEGRAM_CALLBACK_SECRET  — HMAC key signing inline-button callback data.
 *                               Required (the security control on reactions).
 *
 * Dry-run: set COPILOT_TELEGRAM_DRYRUN=1 (or pass dryRun) to skip the network
 * and return { status: "ok", messageId: -1 }. Parallels the calendar fixture
 * override — lets the delivery step (U4) and tests exercise the send path
 * offline.
 *
 * Signed callbacks: button callback_data is `r:<briefItemId>:<code>:<sig>`,
 * where sig is a truncated base64url HMAC-SHA256 over `<briefItemId>:<code>`.
 * This keeps reactions un-forgeable (Telegram callback_data is otherwise
 * attacker-controllable) while staying within the 64-byte callback_data limit.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Bot, InlineKeyboard } from "grammy";
import type { ReactionKind } from "./db/schema.js";

// --- Reaction codes ---------------------------------------------------------
// Short wire codes used in callback_data (kept tiny for the 64-byte budget),
// mapped to the schema's ReactionKind enum.
export const REACTION_CODES = ["handled", "knew", "wrong", "more"] as const;
export type ReactionCode = (typeof REACTION_CODES)[number];

export const CODE_TO_REACTION: Record<ReactionCode, ReactionKind> = {
  handled: "handled",
  knew: "already_knew",
  wrong: "wrong",
  more: "tell_more",
};

// --- Errors -----------------------------------------------------------------
export class TelegramNotConfiguredError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "TelegramNotConfiguredError";
  }
}

// --- Config -----------------------------------------------------------------
export type TelegramConfig = {
  token: string;
  chatId: string;
  callbackSecret: string;
};

/**
 * Load config from env. Throws TelegramNotConfiguredError if any of the three
 * required vars are missing/empty.
 */
export function loadConfig(): TelegramConfig {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const callbackSecret = process.env.TELEGRAM_CALLBACK_SECRET;

  const missing: string[] = [];
  if (!token) missing.push("TELEGRAM_BOT_TOKEN");
  if (!chatId) missing.push("TELEGRAM_CHAT_ID");
  if (!callbackSecret) missing.push("TELEGRAM_CALLBACK_SECRET");
  if (missing.length > 0) {
    throw new TelegramNotConfiguredError(
      `Missing Telegram env var(s): ${missing.join(", ")}. See .env documentation.`,
    );
  }

  return { token: token!, chatId: chatId!, callbackSecret: callbackSecret! };
}

let cachedBot: Bot | null = null;

/**
 * Construct (and memoize) the grammY Bot, or throw TelegramNotConfiguredError
 * when token/chat-id/secret are missing.
 */
export function getBot(): Bot {
  if (cachedBot) return cachedBot;
  const { token } = loadConfig();
  cachedBot = new Bot(token);
  return cachedBot;
}

// --- Signed callback data ---------------------------------------------------
// 128-bit signature. 16 raw HMAC bytes → 22 base64url chars (no padding).
// Byte budget for the longest callback_data: "r:" (2) + up-to-7-digit id (7) +
// ":" (1) + "handled" (7, longest code) + ":" (1) + 22 = 40 bytes ≤ 64.
const SIG_BYTES = 16;

function secretFromEnv(): string {
  const secret = process.env.TELEGRAM_CALLBACK_SECRET;
  if (!secret) {
    throw new TelegramNotConfiguredError(
      "Missing Telegram env var: TELEGRAM_CALLBACK_SECRET. See .env documentation.",
    );
  }
  return secret;
}

/** Compute the truncated base64url HMAC-SHA256 signature over `<id>:<code>`. */
function computeSig(briefItemId: number, code: ReactionCode, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${briefItemId}:${code}`)
    .digest()
    .subarray(0, SIG_BYTES)
    .toString("base64url");
}

/**
 * Build signed callback_data: `r:<briefItemId>:<code>:<sig>`.
 * @param secret injectable signing key (defaults to TELEGRAM_CALLBACK_SECRET).
 */
export function signCallback(
  briefItemId: number,
  code: ReactionCode,
  secret: string = secretFromEnv(),
): string {
  return `r:${briefItemId}:${code}:${computeSig(briefItemId, code, secret)}`;
}

export type VerifiedCallback = {
  briefItemId: number;
  code: ReactionCode;
  reaction: ReactionKind;
};

/**
 * Parse + verify signed callback_data. Returns the decoded fields, or null if
 * the string is malformed or the signature doesn't match (constant-time
 * compare). The secret is injectable so tests don't need real env.
 */
export function verifyCallback(
  data: string,
  secret: string = secretFromEnv(),
): VerifiedCallback | null {
  const parts = data.split(":");
  if (parts.length !== 4) return null;
  const [prefix, idStr, codeStr, sig] = parts as [string, string, string, string];
  if (prefix !== "r") return null;

  // Strict integer parse (reject "12abc", floats, empty, leading zeros noise).
  if (!/^\d+$/.test(idStr)) return null;
  const briefItemId = Number(idStr);
  if (!Number.isSafeInteger(briefItemId)) return null;

  if (!REACTION_CODES.includes(codeStr as ReactionCode)) return null;
  const code = codeStr as ReactionCode;

  const expected = computeSig(briefItemId, code, secret);
  const sigBuf = Buffer.from(sig, "base64url");
  const expBuf = Buffer.from(expected, "base64url");
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;

  return { briefItemId, code, reaction: CODE_TO_REACTION[code] };
}

// --- Message rendering ------------------------------------------------------
/** Render a brief item to the message body (headline + body + suggested action). */
export function renderItem(item: {
  headline: string;
  body: string;
  suggestedAction?: string | null;
}): string {
  const lines = [item.headline, "", item.body];
  if (item.suggestedAction) {
    lines.push("", `Suggested: ${item.suggestedAction}`);
  }
  return lines.join("\n");
}

/** Build the four-button reaction keyboard for a brief item. */
export function buildKeyboard(
  briefItemId: number,
  secret: string = secretFromEnv(),
): InlineKeyboard {
  return new InlineKeyboard()
    .text("Handled", signCallback(briefItemId, "handled", secret))
    .text("Knew", signCallback(briefItemId, "knew", secret))
    .row()
    .text("Wrong", signCallback(briefItemId, "wrong", secret))
    .text("Tell me more", signCallback(briefItemId, "more", secret));
}

// --- Send -------------------------------------------------------------------
export type SendResult =
  | { status: "ok"; messageId: number }
  | { status: "not_configured"; reason: string }
  | { status: "error"; reason: string };

type BriefItemLike = {
  id: number;
  headline: string;
  body: string;
  suggestedAction?: string | null;
};

/**
 * Send one brief item with its reaction keyboard. Non-throwing status union.
 *
 * @param dryRun when true (or COPILOT_TELEGRAM_DRYRUN set), skips the network
 *   and returns { status: "ok", messageId: -1 }.
 */
export async function sendItem(
  item: BriefItemLike,
  dryRun: boolean = !!process.env.COPILOT_TELEGRAM_DRYRUN,
): Promise<SendResult> {
  let config: TelegramConfig;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof TelegramNotConfiguredError) {
      return { status: "not_configured", reason: err.message };
    }
    return { status: "error", reason: err instanceof Error ? err.message : String(err) };
  }

  if (dryRun) {
    return { status: "ok", messageId: -1 };
  }

  try {
    const bot = getBot();
    const sent = await bot.api.sendMessage(config.chatId, renderItem(item), {
      reply_markup: buildKeyboard(item.id, config.callbackSecret),
    });
    return { status: "ok", messageId: sent.message_id };
  } catch (err) {
    return { status: "error", reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Send the single Sunday nudge (U8 web pivot) — plain text, no reaction
 * keyboard, no HMAC. Same non-throwing status union and dry-run handling as
 * sendItem, which is now vestigial for the web flow (kept for the bot listener
 * era; engagement happens on the week-view page).
 */
export async function sendNudge(
  text: string,
  dryRun: boolean = !!process.env.COPILOT_TELEGRAM_DRYRUN,
): Promise<SendResult> {
  let config: TelegramConfig;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof TelegramNotConfiguredError) {
      return { status: "not_configured", reason: err.message };
    }
    return { status: "error", reason: err instanceof Error ? err.message : String(err) };
  }

  if (dryRun) {
    return { status: "ok", messageId: -1 };
  }

  try {
    const sent = await getBot().api.sendMessage(config.chatId, text);
    return { status: "ok", messageId: sent.message_id };
  } catch (err) {
    return { status: "error", reason: err instanceof Error ? err.message : String(err) };
  }
}

// --- Message-edit helpers (used by the bot listener, U5) --------------------
// Thin wrappers around bot.api. They need a live bot, so they are NOT
// unit-tested.

/** Edit a delivered item's text after a reaction lands. */
export async function editItemAfterReaction(messageId: number, text: string): Promise<void> {
  const { chatId } = loadConfig();
  await getBot().api.editMessageText(chatId, messageId, text);
}

/** Strip the inline keyboard from a delivered item (e.g. after a terminal reaction). */
export async function removeItemKeyboard(messageId: number): Promise<void> {
  const { chatId } = loadConfig();
  await getBot().api.editMessageReplyMarkup(chatId, messageId);
}

/** Send a force-reply prompt (used to collect a "wrong" correction). Returns its message id. */
export async function promptForReply(text: string): Promise<number> {
  const { chatId } = loadConfig();
  const sent = await getBot().api.sendMessage(chatId, text, {
    reply_markup: { force_reply: true },
  });
  return sent.message_id;
}

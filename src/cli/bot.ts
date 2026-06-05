/**
 * U5 — Bot listener (reaction capture).
 *
 * The first long-running process in the repo. It runs grammY long polling and
 * turns Telegram interactions into deterministic loop effects:
 *
 *   - A tap on a brief item's inline button → verifyCallback (U3) → applyReaction
 *     (U7), then it reflects the result back into the chat (toast + edit / strip
 *     keyboard) and, for a "wrong" tap, sends a force-reply prompt.
 *   - A reply to that force-reply prompt → captured as the correction text on the
 *     reaction row (FIRST-WRITE-WINS), then applyCorrection (U8 — the only LLM
 *     step) runs OFF the hot path.
 *
 * The handlers are intentionally THIN: the security (signed callbacks), the
 * deterministic semantics, and the LLM step all live in already-unit-tested libs.
 * This file is verified manually against a live bot — there are no live-network
 * unit tests here.
 *
 * Authorization: a `bot.use` middleware runs FIRST and drops any update not from
 * the configured TELEGRAM_CHAT_ID. Telegram callback_data is attacker-supplied,
 * so the signed-callback check (verifyCallback) is the real control; the chat
 * gate is defense-in-depth that also stops a stranger's force-reply from ever
 * reaching the capture handler.
 *
 * Run: `npm run bot` (tsx --env-file=.env src/cli/bot.ts).
 */

import { and, eq, isNull } from "drizzle-orm";

import { db } from "../lib/db/index.js";
import { reactions } from "../lib/db/schema.js";
import { applyCorrection } from "../lib/correct.js";
import { applyReaction, type ReactionResult } from "../lib/reactions.js";
import {
  TelegramNotConfiguredError,
  editItemAfterReaction,
  getBot,
  loadConfig,
  promptForReply,
  removeItemKeyboard,
  verifyCallback,
} from "../lib/telegram.js";

const WRONG_PROMPT = "What did I get wrong about your kid?";

/**
 * A stable, PII-free label for an error. We log the error's class name (and a
 * grammY error code when present) but NOT its message body — error messages can
 * embed children's data, spine paths, or raw model output (F10).
 */
function errLabel(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { error_code?: number }).error_code;
    return code !== undefined ? `${err.name}[code=${code}]` : err.name;
  }
  return typeof err;
}

/**
 * The user-facing toast text for a reaction result. Pure + tiny, but it's the
 * one bit of branching worth pinning down without a live bot, so it's exported
 * for a unit test.
 */
export function toastFor(result: ReactionResult): string {
  switch (result.kind) {
    case "fact_updated":
      return `Got it — ${result.detail}.`;
    case "suppressed":
      return "Got it — I won't resurface this.";
    case "quarantined":
      return "Thanks — what did I get wrong?";
    case "reveal_reasoning":
      return "Here's why this surfaced.";
    case "noop_duplicate":
      return "Already recorded.";
  }
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof TelegramNotConfiguredError) {
      console.error(`Telegram not configured: ${err.message}`);
      console.error(
        "Set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, and TELEGRAM_CALLBACK_SECRET in .env, then re-run `npm run bot`.",
      );
      process.exit(1);
    }
    throw err;
  }

  const bot = getBot();
  const secret = config.callbackSecret;
  const allowedChatId = config.chatId;

  // Defensive: clear any webhook so long polling doesn't 409.
  await bot.api.deleteWebhook();

  // --- Authorization (must run FIRST) ---------------------------------------
  // Drop anything not from the configured chat. On a stray callback query we
  // still answer it (so the sender's client stops spinning) but do nothing else.
  bot.use(async (ctx, next) => {
    const fromAllowedChat = String(ctx.chat?.id) === allowedChatId;
    if (fromAllowedChat) {
      await next();
      return;
    }
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
    }
    // Otherwise (message / other update): ignore silently.
  });

  // --- Reaction taps --------------------------------------------------------
  // The handler body is wrapped so that answerCallbackQuery is ALWAYS called
  // (even on a thrown error) — otherwise the user's client spins forever waiting
  // for the ack. The reflection (edit/strip/prompt) is best-effort after the ack.
  bot.callbackQuery(/^r:/, async (ctx) => {
    const verified = verifyCallback(ctx.callbackQuery.data, secret);
    if (!verified) {
      // Forged / tampered / malformed callback data.
      await ctx.answerCallbackQuery({ text: "Invalid" });
      return;
    }

    const messageId = ctx.callbackQuery.message?.message_id;

    let result: ReactionResult;
    try {
      result = await applyReaction(
        verified.briefItemId,
        verified.reaction,
        ctx.callbackQuery.id, // idempotency key
      );
    } catch (err) {
      // Containment: never leave the tap un-acked. Log a stable label only.
      console.error(`bot: applyReaction failed (briefItemId=${verified.briefItemId})`, errLabel(err));
      await ctx.answerCallbackQuery({ text: "Something went wrong — try again." });
      return;
    }

    // Mandatory ack, with a short toast.
    await ctx.answerCallbackQuery({ text: toastFor(result) });

    if (messageId === undefined) return; // nothing to reflect onto

    // Reflection is best-effort: a failure here must not crash the listener.
    try {
      switch (result.kind) {
        case "reveal_reasoning":
          // Show the reasoning but LEAVE the keyboard — the user may still react.
          await editItemAfterReaction(messageId, `Why this surfaced:\n\n${result.reasoning}`);
          break;

        case "quarantined": {
          // Terminal for the keyboard; collect the correction via force-reply and
          // remember the prompt's message id on the reaction row so the reply
          // handler can find it.
          await removeItemKeyboard(messageId);
          const promptMessageId = await promptForReply(WRONG_PROMPT);
          db.update(reactions)
            .set({ promptMessageId })
            .where(eq(reactions.id, result.reactionId))
            .run();
          break;
        }

        case "fact_updated":
        case "suppressed":
          // Handled / already-knew: the item is done — strip the keyboard so
          // re-taps are blocked.
          await removeItemKeyboard(messageId);
          break;

        case "noop_duplicate":
          // A re-tap of an already-recorded reaction. The toast already told the
          // user; leave the message as-is.
          break;
      }
    } catch (err) {
      console.error(`bot: reflection failed (reactionId=${result.reactionId})`, errLabel(err));
    }
  });

  // --- Correction replies ---------------------------------------------------
  // Wrapped so a throw can't kill the long-polling listener.
  bot.on("message:text", async (ctx) => {
    try {
      const replyToId = ctx.message.reply_to_message?.message_id;
      if (replyToId === undefined) return; // not a reply → ignore

      const replyMessageId = ctx.message.message_id;

      // FIRST-WRITE-WINS: only an unfilled, still-pending row anchored on this
      // exact prompt accepts the correction. The WHERE clause does the gating, so
      // a concurrent/duplicate reply is a no-op (0 rows changed).
      const updated = db
        .update(reactions)
        .set({ correctionText: ctx.message.text, replyMessageId })
        .where(
          and(
            eq(reactions.promptMessageId, replyToId),
            eq(reactions.appliedStatus, "pending"),
            isNull(reactions.correctionText),
          ),
        )
        .returning({ id: reactions.id })
        .all();

      if (updated.length === 0) {
        // No matching prompt, already captured, or already applied → ignore.
        return;
      }

      const reactionId = updated[0]!.id;
      await ctx.reply("Thanks — noted.");

      // Off the hot path: the only LLM call in the loop runs fire-and-forget so it
      // doesn't block the listener's event-loop tick.
      void applyCorrection(reactionId).catch((err) => {
        console.error(`bot: applyCorrection failed (reactionId=${reactionId})`, errLabel(err));
      });
    } catch (err) {
      console.error("bot: message:text handler failed", errLabel(err));
    }
  });

  // Backstop: catch anything the per-handler guards miss so the process survives.
  bot.catch((err) => {
    console.error("bot: unhandled error in update handler", errLabel(err));
  });

  // --- Lifecycle ------------------------------------------------------------
  const stop = (): void => {
    void bot.stop();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log("Bot listening (long polling)…");
  await bot.start();
}

await main();

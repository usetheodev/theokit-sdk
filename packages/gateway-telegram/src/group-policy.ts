/**
 * Group-chat policy for Telegram bots (T5.1, ported from
 * examples/telegram-pro/src/group-policy.ts).
 *
 * In private chats: respond to everything.
 * In groups: respond only when:
 *  1. the user @-mentions the bot OR
 *  2. the message is a reply to one of the bot's earlier messages OR
 *  3. it's a slash command (Telegram auto-routes those to the bot).
 *
 * Without this filter, a Telegram bot in a group becomes a noisemaker.
 * Register as a `pre_inbound` hook on the runner.
 *
 * @public
 */

import type { Context } from "grammy";

/** Policy state. Build once per bot at boot from `bot.botInfo`. */
export interface PolicyContext {
  /** The bot's username (without leading `@`). */
  readonly botUsername: string;
  /** The bot's user id. Used to detect reply-to-bot. */
  readonly botId: number;
}

/**
 * Decide whether the bot should respond to this update.
 * @public
 */
export function shouldRespondInChat(ctx: Context, policy: PolicyContext): boolean {
  const chat = ctx.chat;
  if (chat === undefined) return false;
  if (chat.type === "private") return true;
  const text = ctx.message?.text ?? ctx.message?.caption ?? "";
  if (text.startsWith("/")) return true;
  const replyTo = ctx.message?.reply_to_message;
  if (replyTo?.from?.id === policy.botId) return true;
  const mentionTag = `@${policy.botUsername.toLowerCase()}`;
  if (text.toLowerCase().includes(mentionTag)) return true;
  return false;
}

/** Strip the bot's @-mention from a message so the LLM doesn't see it. @public */
export function stripBotMention(text: string, botUsername: string): string {
  const regex = new RegExp(`@${botUsername}`, "gi");
  return text.replace(regex, "").trim();
}

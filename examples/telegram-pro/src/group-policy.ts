import type { Context } from "grammy";

/**
 * Group-chat policy: in private chats the bot replies to everything; in
 * groups it ONLY replies when:
 *   1. the user @-mentions the bot in the message text, OR
 *   2. the message is a reply to one of the bot's earlier messages, OR
 *   3. it's a slash command (Telegram auto-routes those).
 *
 * Mirrors OpenClaw's group-policy.ts behaviour. Without this filter, the
 * bot becomes the noisiest member of every group it joins.
 *
 * @internal to the example
 */

export interface PolicyContext {
  /** The bot's own username (without `@`). */
  botUsername: string;
  /** The bot's own user-id. Used to detect reply-to-bot. */
  botId: number;
}

export function shouldRespondInChat(ctx: Context, policy: PolicyContext): boolean {
  const chat = ctx.chat;
  if (chat === undefined) return false;
  if (chat.type === "private") return true;
  // Slash commands are always routed to the bot by Telegram; handlers run.
  const text = ctx.message?.text ?? ctx.message?.caption ?? "";
  if (text.startsWith("/")) return true;
  // Reply to one of OUR previous messages
  const replyTo = ctx.message?.reply_to_message;
  if (replyTo?.from?.id === policy.botId) return true;
  // @-mention
  const mentionTag = `@${policy.botUsername.toLowerCase()}`;
  if (text.toLowerCase().includes(mentionTag)) return true;
  return false;
}

/** Strip the bot's @-mention from a message so the LLM doesn't see it. */
export function stripBotMention(text: string, botUsername: string): string {
  const regex = new RegExp(`@${botUsername}`, "gi");
  return text.replace(regex, "").trim();
}

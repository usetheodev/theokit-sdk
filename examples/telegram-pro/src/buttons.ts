import { InlineKeyboard } from "grammy";

/**
 * Inline-keyboard protocol between the agent and Telegram.
 *
 * The agent embeds a marker line in its reply text:
 *
 *     Sure, want me to send the email?
 *     [BUTTONS: Yes | No | Edit first]
 *
 * We strip the marker, render a Telegram InlineKeyboard with the three
 * options, and prepend `tg-pro:` to each callback_data so we can route
 * presses back to the agent loop unambiguously.
 *
 * When the user taps a button, the bot answers the callback (so Telegram
 * removes the "loading" spinner) and forwards the choice back to the agent
 * as the next user turn — keeping memory/sessions consistent.
 *
 * @internal to the example
 */

const BUTTON_MARKER = /\[BUTTONS:\s*([^\]]+)\]/i;
const CALLBACK_PREFIX = "tg-pro:";

export interface ButtonResult {
  cleanText: string;
  keyboard?: InlineKeyboard;
}

/**
 * Parse the agent's reply. If the marker is present, return the text WITHOUT
 * the marker plus a populated InlineKeyboard. Otherwise return the text
 * untouched and `keyboard: undefined`.
 */
export function extractButtons(text: string): ButtonResult {
  const match = text.match(BUTTON_MARKER);
  if (match === null || match[1] === undefined) {
    return { cleanText: text };
  }
  const labels = match[1]
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 5);
  if (labels.length === 0) return { cleanText: text.replace(BUTTON_MARKER, "").trim() };
  const keyboard = new InlineKeyboard();
  for (const label of labels) {
    keyboard.text(label, `${CALLBACK_PREFIX}${label}`).row();
  }
  const cleanText = text.replace(BUTTON_MARKER, "").trim();
  return { cleanText, keyboard };
}

export function isAgentCallback(data: string): boolean {
  return data.startsWith(CALLBACK_PREFIX);
}

export function decodeCallback(data: string): string {
  return data.slice(CALLBACK_PREFIX.length);
}

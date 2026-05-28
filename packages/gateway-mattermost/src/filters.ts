/**
 * Inbound dispatch pipeline (D403, EC-2).
 *
 * Order matters — these checks compose:
 *
 * 1. Loop guard: drop bot's own posts (D275 mirror).
 * 2. DM channels: always respond.
 * 3. `requireMention === false`: respond.
 * 4. **Metadata.mentions** array contains bot user-id → respond (PRIORITY).
 * 5. **Word-boundary text regex** `\b@${botUsername}\b` → respond.
 * 6. Else: ignore.
 *
 * EC-2: substring match (`post.message.includes("@theo")`) catches
 * `@theory_dept` and dispatches false-positive. The fix is two-fold:
 * prefer the unambiguous `metadata.mentions` array (API-provided
 * user-ids), and when text fallback is required, use `\b` boundaries.
 */

import type { MattermostPost } from "./types.js";

export interface ShouldRespondOptions {
  readonly post: MattermostPost;
  readonly channelType: "dm" | "group" | "thread";
  readonly botUserId: string;
  readonly botUsername: string;
  readonly requireMention: boolean;
}

export function shouldRespond(opts: ShouldRespondOptions): boolean {
  const { post, channelType, botUserId, botUsername, requireMention } = opts;
  // 1. Loop guard.
  if (post.user_id === botUserId) return false;
  // 2. DM — always.
  if (channelType === "dm") return true;
  // 3. Opt-out of mention enforcement.
  if (!requireMention) return true;
  // 4. metadata.mentions takes priority — never ambiguous.
  const mentioned = post.metadata?.mentions?.includes(botUserId) ?? false;
  if (mentioned) return true;
  // 5. Text fallback with word boundary (EC-2).
  if (botUsername.length > 0 && hasMentionWithBoundary(post.message, botUsername)) {
    return true;
  }
  return false;
}

/**
 * Word-boundary match for `@${botUsername}`. Word boundaries land at
 * `\b` (start/end of `\w` regions), so `@theo` at the head of `@theory`
 * does NOT match because `\b` is between `o` and `r` only when the
 * NEXT char is a non-word char.
 *
 * @public — exported for unit tests + consumer-side reuse.
 */
export function hasMentionWithBoundary(text: string, botUsername: string): boolean {
  // Escape regex metacharacters in username (Mattermost allows `.`, `_`, `-`).
  const safe = botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^\\w])@${safe}(?![\\w.])`, "u");
  return re.test(text);
}

/**
 * Map Slack API errors to canonical `SendResult` codes (ADR D273).
 *
 * @internal
 */

import type { SendResult } from "@usetheo/gateway";

interface SlackErrorLike {
  code?: string;
  data?: { error?: string; retry_after?: number; needed?: string; scope?: string };
  message?: string;
}

export function mapSlackError(err: unknown): SendResult {
  const e = err as SlackErrorLike;
  const code = e.data?.error ?? e.code ?? "platform_error";
  switch (code) {
    case "rate_limited":
      return {
        ok: false,
        error: {
          code: "rate_limit",
          message: `retry after ${e.data?.retry_after ?? "?"}s`,
        },
      };
    case "channel_not_found":
      return {
        ok: false,
        error: { code: "channel_not_found", message: "channel id not found" },
      };
    case "not_in_channel":
    case "missing_scope":
      return {
        ok: false,
        error: {
          code: "no_permission",
          message: e.data?.needed ?? e.data?.scope ?? code,
        },
      };
    case "invalid_auth":
    case "token_revoked":
    case "account_inactive":
      return { ok: false, error: { code: "auth_error", message: code } };
    case "message_limit_exceeded":
    case "msg_too_long":
      return { ok: false, error: { code: "message_too_long", message: code } };
    default:
      return {
        ok: false,
        error: {
          code: "platform_error",
          message: `${code}: ${e.message ?? "unknown"}`,
        },
      };
  }
}

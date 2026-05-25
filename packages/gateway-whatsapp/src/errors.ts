/**
 * Per-backend HTTP/IPC error → canonical `WhatsAppSendResult.error` shape.
 *
 * Cloud follows Meta error codes (https://developers.facebook.com/docs/graph-api/guides/error-handling).
 * Web follows whatsapp-web.js error strings.
 *
 * @internal
 */

import type { WhatsAppSendResult } from "./backend-types.js";

type ErrorPayload = Required<WhatsAppSendResult>["error"];

interface MetaErrorBody {
  error?: {
    code?: number;
    message?: string;
    error_subcode?: number;
  };
}

/** Custom error: `connect()` timed out waiting for "ready" (EC-6). */
export class WhatsAppConnectTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`WhatsApp web bridge connect timed out after ${timeoutMs}ms (QR code not scanned?)`);
    this.name = "WhatsAppConnectTimeoutError";
  }
}

function cloudErrorCode(
  status: number,
  errCode: number,
): "auth_failed" | "rate_limit" | "invalid_request" | "server_error" | "unknown" {
  if (errCode === 190 || status === 401) return "auth_failed";
  if (errCode === 130 || errCode === 131 || status === 429) return "rate_limit";
  if (status === 400 || errCode === 100) return "invalid_request";
  if (status >= 500) return "server_error";
  return "unknown";
}

export function mapWhatsAppCloudError(status: number, body: unknown): ErrorPayload {
  const parsed = (body !== null && typeof body === "object" ? body : {}) as MetaErrorBody;
  const errCode = parsed.error?.code ?? 0;
  const errMsg = parsed.error?.message ?? `HTTP ${status}`;
  const code = cloudErrorCode(status, errCode);
  if (code === "auth_failed") return { code, message: `Bearer token rejected: ${errMsg}` };
  if (code === "rate_limit") return { code, message: `Throttled: ${errMsg}` };
  return { code, message: errMsg };
}

export function mapWhatsAppWebError(ipcError: string | undefined): ErrorPayload {
  const msg = ipcError ?? "unknown bridge error";
  if (msg.includes("AUTHENTICATION") || msg.includes("UNAUTHORIZED")) {
    return { code: "auth_failed", message: msg };
  }
  if (msg.includes("RATE") || msg.includes("THROTTLE")) {
    return { code: "rate_limit", message: msg };
  }
  if (msg.includes("PROTOCOL") || msg.includes("DISCONNECT")) {
    return { code: "server_error", message: msg };
  }
  if (msg.includes("TIMEOUT")) {
    return { code: "timeout", message: msg };
  }
  return { code: "unknown", message: msg };
}

/**
 * Plivo backend impl.
 *
 * - SDK: `plivo` (peer-dep, optional).
 * - Signature: `X-Plivo-Signature-V3` is HMAC-SHA256 of the request URL
 *   + nonce + body. `validateV3Signature` is exposed by the SDK; we
 *   delegate to avoid reimplementation.
 *
 * @internal
 */

import type { SendResult } from "@usetheo/gateway";
import type { SignatureContext, SMSBackend, SMSInbound } from "../backend-types.js";
import { BackendNotInstalledError } from "../errors.js";
import { normalizeE164 } from "../phone.js";
import type { PlivoOptions } from "../types.js";

interface PlivoCreateResponse {
  apiId?: string;
  messageUuid?: string[];
  message_uuid?: string[];
}

interface PlivoClient {
  messages: {
    // The actual SDK uses positional args: create(src, dst, text, ...).
    create(src: string, dst: string, text: string): Promise<PlivoCreateResponse>;
  };
}

interface PlivoModule {
  Client: new (authId?: string, authToken?: string) => PlivoClient;
  // Real SDK signature: validateV3Signature(method, uri, nonce, authToken, v3Signature)
  validateV3Signature?: (
    method: string,
    uri: string,
    nonce: string,
    authToken: string,
    signature: string,
  ) => boolean;
}

async function loadPlivo(): Promise<PlivoModule> {
  try {
    // Plivo's published types are stricter (positional args) than our
    // generic mock; we narrow at call sites and pass through unknown.
    const mod = (await import("plivo")) as unknown as PlivoModule;
    return mod;
  } catch {
    throw new BackendNotInstalledError("plivo", "plivo");
  }
}

export class PlivoBackend implements SMSBackend {
  readonly kind = "plivo" as const;
  private mod: PlivoModule | undefined;
  private client: PlivoClient | undefined;

  constructor(private readonly opts: PlivoOptions) {}

  async connect(): Promise<boolean> {
    if (this.client !== undefined) return true;
    this.mod = await loadPlivo();
    this.client = new this.mod.Client(this.opts.authId, this.opts.authToken);
    return true;
  }

  async disconnect(): Promise<void> {
    this.client = undefined;
  }

  verifySignature(ctx: SignatureContext): boolean {
    if (this.mod?.validateV3Signature === undefined) return false;
    const signature = ctx.headers["x-plivo-signature-v3"];
    const nonce = ctx.headers["x-plivo-signature-v3-nonce"];
    if (signature === undefined || nonce === undefined) return false;
    try {
      return this.mod.validateV3Signature("POST", ctx.url, nonce, this.opts.authToken, signature);
    } catch {
      return false;
    }
  }

  parseInbound(ctx: SignatureContext): SMSInbound {
    let params: Record<string, string> = {};
    // Plivo posts JSON or form-encoded depending on application config.
    if ((ctx.headers["content-type"] ?? "").includes("application/json")) {
      try {
        params = JSON.parse(ctx.rawBody) as Record<string, string>;
      } catch {
        params = {};
      }
    } else {
      params = parseFormUrlEncoded(ctx.rawBody);
    }
    return {
      from: normalizeE164(params.From ?? "", this.opts.defaultCountry),
      to: normalizeE164(params.To ?? "", this.opts.defaultCountry),
      body: params.Text ?? params.text ?? "",
      messageId: params.MessageUUID ?? params.message_uuid ?? "",
      receivedAt: Date.now(),
      raw: params,
    };
  }

  async sendMessage(to: string, body: string): Promise<SendResult> {
    if (this.client === undefined) {
      return {
        ok: false,
        error: { code: "not_connected", message: "PlivoBackend.connect() not called" },
      };
    }
    try {
      const resp = await this.client.messages.create(this.opts.fromNumber, to, body);
      const id = resp.messageUuid?.[0] ?? resp.message_uuid?.[0] ?? resp.apiId ?? "";
      return { ok: true, messageId: id };
    } catch (err) {
      return mapPlivoError(err);
    }
  }
}

function parseFormUrlEncoded(body: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of body.split("&")) {
    if (pair.length === 0) continue;
    const eqIdx = pair.indexOf("=");
    const k = eqIdx < 0 ? pair : pair.slice(0, eqIdx);
    const v = eqIdx < 0 ? "" : pair.slice(eqIdx + 1);
    params[decodeURIComponent(k.replace(/\+/g, " "))] = decodeURIComponent(v.replace(/\+/g, " "));
  }
  return params;
}

interface PlivoRestError {
  statusCode?: number;
  status?: number;
  message?: string;
}

function mapPlivoError(err: unknown): SendResult {
  const e = err as PlivoRestError;
  const status = e.statusCode ?? e.status ?? 0;
  if (status === 429)
    return { ok: false, error: { code: "rate_limit", message: e.message ?? "Plivo rate limit" } };
  if (status === 401 || status === 403) {
    return {
      ok: false,
      error: { code: "permission_denied", message: e.message ?? "Plivo auth error" },
    };
  }
  if (status === 400) {
    return {
      ok: false,
      error: { code: "invalid_request", message: e.message ?? "Plivo rejected request" },
    };
  }
  return {
    ok: false,
    error: {
      code: "send_failed",
      message: e.message ?? (err instanceof Error ? err.message : String(err)),
    },
  };
}

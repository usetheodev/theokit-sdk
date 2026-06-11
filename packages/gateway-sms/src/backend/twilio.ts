/**
 * Twilio backend impl.
 *
 * - SDK: `twilio` (peer-dep, optional). Loaded lazily so packages
 *   that pick other backends don't pay the cost.
 * - Signature: `X-Twilio-Signature` is HMAC-SHA1 of `(fullUrl + sortedParams)`.
 *   We delegate to `twilio.validateRequest` so we don't reimplement.
 *
 * @internal
 */

import type { SendResult } from "@theokit/gateway";
import type { SignatureContext, SMSBackend, SMSInbound } from "../backend-types.js";
import { BackendNotInstalledError } from "../errors.js";
import { normalizeE164 } from "../phone.js";
import type { TwilioOptions } from "../types.js";

interface TwilioCreateArgs {
  from: string;
  to: string;
  body: string;
}

interface TwilioMessageInstance {
  sid: string;
  status?: string;
}

interface TwilioClientInstance {
  messages: {
    create(args: TwilioCreateArgs): Promise<TwilioMessageInstance>;
  };
}

interface TwilioFactory {
  (accountSid: string, authToken: string): TwilioClientInstance;
  validateRequest(
    authToken: string,
    signature: string,
    url: string,
    params: Record<string, string>,
  ): boolean;
}

async function loadTwilio(): Promise<TwilioFactory> {
  try {
    const mod = await import("twilio");
    // ESM ships { default: factory }; CJS ships factory.
    const candidate =
      (mod as { default?: TwilioFactory }).default ?? (mod as unknown as TwilioFactory);
    return candidate;
  } catch {
    throw new BackendNotInstalledError("twilio", "twilio");
  }
}

export class TwilioBackend implements SMSBackend {
  readonly kind = "twilio" as const;
  private client: TwilioClientInstance | undefined;
  private twilio: TwilioFactory | undefined;

  constructor(private readonly opts: TwilioOptions) {}

  async connect(): Promise<boolean> {
    if (this.client !== undefined) return true;
    this.twilio = await loadTwilio();
    this.client = this.twilio(this.opts.accountSid, this.opts.authToken);
    return true;
  }

  async disconnect(): Promise<void> {
    // No persistent connection — REST client is GC'd on dereference.
    this.client = undefined;
  }

  verifySignature(ctx: SignatureContext): boolean {
    if (this.twilio === undefined) return false;
    const signature = ctx.headers["x-twilio-signature"];
    if (signature === undefined) return false;
    const params = parseFormUrlEncoded(ctx.rawBody);
    try {
      return this.twilio.validateRequest(this.opts.authToken, signature, ctx.url, params);
    } catch {
      return false;
    }
  }

  parseInbound(ctx: SignatureContext): SMSInbound {
    const params = parseFormUrlEncoded(ctx.rawBody);
    return {
      from: normalizeE164(params.From ?? "", this.opts.defaultCountry),
      to: normalizeE164(params.To ?? "", this.opts.defaultCountry),
      body: params.Body ?? "",
      messageId: params.MessageSid ?? params.SmsMessageSid ?? "",
      receivedAt: Date.now(),
      raw: params,
    };
  }

  async sendMessage(to: string, body: string): Promise<SendResult> {
    if (this.client === undefined) {
      return {
        ok: false,
        error: { code: "not_connected", message: "TwilioBackend.connect() not called" },
      };
    }
    try {
      const msg = await this.client.messages.create({ from: this.opts.fromNumber, to, body });
      return { ok: true, messageId: msg.sid };
    } catch (err) {
      return mapTwilioError(err);
    }
  }
}

/**
 * Parse `application/x-www-form-urlencoded` request body to a flat
 * `Record<string, string>`. Twilio POSTs in this format.
 *
 * @internal
 */
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

interface TwilioRestError {
  status?: number;
  code?: number | string;
  message?: string;
}

function mapTwilioError(err: unknown): SendResult {
  const e = err as TwilioRestError;
  const status = e.status ?? 0;
  if (status === 429) {
    return { ok: false, error: { code: "rate_limit", message: e.message ?? "Twilio rate limit" } };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      error: { code: "permission_denied", message: e.message ?? "Twilio auth error" },
    };
  }
  if (status === 400) {
    return {
      ok: false,
      error: { code: "invalid_request", message: e.message ?? "Twilio rejected request" },
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

/**
 * Vonage backend impl.
 *
 * - SDK: `@vonage/server-sdk` (peer-dep, optional).
 * - Signature: `Authorization: Bearer <JWT>` signed with the Signature
 *   Secret (NOT the API secret). The SDK exposes `Auth.verifySignature`
 *   for this purpose.
 *
 * @internal
 */

import type { SendResult } from "@theokit/gateway";
import type { SignatureContext, SMSBackend, SMSInbound } from "../backend-types.js";
import { BackendNotInstalledError } from "../errors.js";
import { normalizeE164 } from "../phone.js";
import type { VonageOptions } from "../types.js";

interface VonageSmsClient {
  send(args: { to: string; from: string; text: string }): Promise<{
    messages?: Array<{ "message-id"?: string; messageId?: string; status?: string }>;
  }>;
}

interface VonageInstance {
  sms: VonageSmsClient;
}

interface VonageModule {
  Vonage: new (creds: {
    apiKey: string;
    apiSecret: string;
    signatureSecret?: string;
  }) => VonageInstance;
  Auth?: {
    verifySignature?: (token: string, secret: string) => boolean;
  };
}

async function loadVonage(): Promise<VonageModule> {
  try {
    // SDK ships ESM/CJS variants; we narrow at call sites and pass through.
    const raw = await import("@vonage/server-sdk");
    return raw as unknown as VonageModule;
  } catch {
    throw new BackendNotInstalledError("vonage", "@vonage/server-sdk");
  }
}

export class VonageBackend implements SMSBackend {
  readonly kind = "vonage" as const;
  private mod: VonageModule | undefined;
  private vonage: VonageInstance | undefined;

  constructor(private readonly opts: VonageOptions) {}

  async connect(): Promise<boolean> {
    if (this.vonage !== undefined) return true;
    this.mod = await loadVonage();
    this.vonage = new this.mod.Vonage({
      apiKey: this.opts.apiKey,
      apiSecret: this.opts.apiSecret,
      signatureSecret: this.opts.signatureSecret,
    });
    return true;
  }

  async disconnect(): Promise<void> {
    this.vonage = undefined;
  }

  verifySignature(ctx: SignatureContext): boolean {
    const auth = ctx.headers.authorization;
    if (auth === undefined) return false;
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m === null) return false;
    const token = m[1] ?? "";
    if (token.length === 0) return false;
    if (this.mod?.Auth?.verifySignature === undefined) return false;
    try {
      return this.mod.Auth.verifySignature(token, this.opts.signatureSecret);
    } catch {
      return false;
    }
  }

  parseInbound(ctx: SignatureContext): SMSInbound {
    let payload: Record<string, string> = {};
    try {
      payload = JSON.parse(ctx.rawBody) as Record<string, string>;
    } catch {
      payload = {};
    }
    return {
      from: normalizeE164(payload.msisdn ?? payload.from ?? "", this.opts.defaultCountry),
      to: normalizeE164(payload.to ?? "", this.opts.defaultCountry),
      body: payload.text ?? "",
      messageId: payload.messageId ?? payload["message-id"] ?? "",
      receivedAt: Date.now(),
      raw: payload,
    };
  }

  async sendMessage(to: string, body: string): Promise<SendResult> {
    if (this.vonage === undefined) {
      return {
        ok: false,
        error: { code: "not_connected", message: "VonageBackend.connect() not called" },
      };
    }
    try {
      const resp = await this.vonage.sms.send({ from: this.opts.fromNumber, to, text: body });
      const msg = resp.messages?.[0];
      const id = msg?.["message-id"] ?? msg?.messageId ?? "";
      if (msg?.status !== undefined && msg.status !== "0") {
        return {
          ok: false,
          error: { code: "send_failed", message: `Vonage returned status=${msg.status}` },
        };
      }
      return { ok: true, messageId: id };
    } catch (err) {
      return mapVonageError(err);
    }
  }
}

interface VonageRestError {
  status?: number;
  response?: { status?: number };
  message?: string;
}

function mapVonageError(err: unknown): SendResult {
  const e = err as VonageRestError;
  const status = e.status ?? e.response?.status ?? 0;
  if (status === 429)
    return { ok: false, error: { code: "rate_limit", message: e.message ?? "Vonage rate limit" } };
  if (status === 401 || status === 403) {
    return {
      ok: false,
      error: { code: "permission_denied", message: e.message ?? "Vonage auth error" },
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

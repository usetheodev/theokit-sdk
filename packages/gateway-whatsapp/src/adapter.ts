/**
 * `WhatsAppAdapter` — WhatsApp platform adapter for `@usetheo/gateway`
 * (Adoption Roadmap v1.4 #2; ADRs D303-D314).
 *
 * Multi-backend (Cloud + Web) — backend chosen via `WhatsAppAdapterOptions.backend`.
 * Backend-agnostic adapter delegates lifecycle + send + subscribe through the
 * `WhatsAppBackend` seam (D303).
 *
 * @public
 */

import {
  BasePlatformAdapter,
  type MessageEvent as GatewayMessageEvent,
  type OutboundMessage,
  type SendResult,
  type WhatsAppMessageEvent,
} from "@usetheo/gateway";

import type { WhatsAppBackend, WhatsAppStatusReceipt } from "./backend-types.js";
import { splitForWhatsApp } from "./split.js";

/** Cloud (Meta WhatsApp Business Cloud API) backend config (ADR D304). */
export interface WhatsAppCloudConfig {
  /** Meta system-user / phone-number access token. */
  readonly accessToken: string;
  /** Meta-issued phone-number-id (NOT the user-facing phone). */
  readonly phoneNumberId: string;
  /** App secret used to verify `X-Hub-Signature-256` on inbound webhooks. */
  readonly appSecret: string;
  /** Graph API version. Defaults to `v18.0`. */
  readonly apiVersion?: string;
}

/** Web (whatsapp-web.js subprocess bridge) backend config (ADR D305). */
export interface WhatsAppWebConfig {
  /** Stable session id used to lock the bridge per-workspace. */
  readonly sessionId: string;
  /** Optional override of the bridge script path (defaults to packaged bridge). */
  readonly bridgeScriptPath?: string;
}

/** Discriminated options shape (ADR D311). */
export type WhatsAppAdapterOptions =
  | {
      readonly backend: "cloud";
      readonly cloud: WhatsAppCloudConfig;
      /** D309: require @mention in groups. Default `true`. */
      readonly requireMention?: boolean;
      /** Phone id to detect mentions of (digits only). Defaults to `cloud.phoneNumberId`. */
      readonly botPhoneId?: string;
    }
  | {
      readonly backend: "web";
      readonly web: WhatsAppWebConfig;
      readonly requireMention?: boolean;
      /** Phone id to detect mentions of (digits only). Required for groups in web mode. */
      readonly botPhoneId?: string;
    };

/** EC-7: digit-only normalizer for mention comparison (handles `+`, `-`, `()`, spaces). */
export function digitsOnly(s: string): string {
  return s.replace(/[^\d]/g, "");
}

/**
 * Adapter façade. Implements `BasePlatformAdapter` (D172).
 *
 * Use `WhatsAppAdapter.fromCloud(config)` or `WhatsAppAdapter.fromWeb(config)`
 * once the backend factories land (or pass `backend` directly in constructor).
 */
export class WhatsAppAdapter extends BasePlatformAdapter {
  readonly platform = "whatsapp" as const;
  private readonly backendImpl: WhatsAppBackend;
  private readonly requireMention: boolean;
  private readonly botPhoneId: string;
  private handler?: (event: GatewayMessageEvent) => Promise<void>;
  private statusHandler?: (receipt: WhatsAppStatusReceipt) => Promise<void>;
  // EC-H: track unsubscribe handles so onInbound REPLACES instead of stacks.
  private inboundUnsubscribe?: () => void;
  private statusUnsubscribe?: () => void;

  /** Construct from a pre-built backend (used by the static factories + tests). */
  constructor(
    backendImpl: WhatsAppBackend,
    opts: { requireMention?: boolean; botPhoneId?: string } = {},
  ) {
    super();
    this.backendImpl = backendImpl;
    this.requireMention = opts.requireMention ?? true;
    this.botPhoneId = digitsOnly(opts.botPhoneId ?? "");
  }

  /** Escape hatch (D180-style) for advanced features. */
  getBackend(): WhatsAppBackend {
    return this.backendImpl;
  }

  async connect(): Promise<boolean> {
    return this.backendImpl.connect();
  }

  async disconnect(): Promise<void> {
    this.inboundUnsubscribe?.();
    this.inboundUnsubscribe = undefined;
    this.statusUnsubscribe?.();
    this.statusUnsubscribe = undefined;
    this.handler = undefined;
    this.statusHandler = undefined;
    await this.backendImpl.disconnect();
  }

  async sendMessage(out: OutboundMessage): Promise<SendResult> {
    if (out.text.length === 0) {
      return { ok: false, error: { code: "empty_text", message: "Empty text rejected." } };
    }
    // EC-8: split filters empty parts internally.
    const parts = splitForWhatsApp(out.text);
    if (parts.length === 0) {
      return {
        ok: false,
        error: { code: "empty_text", message: "Text reduced to zero parts after splitting." },
      };
    }
    let lastWamid: string | undefined;
    const isGroup = out.channel.type === "group";
    for (const part of parts) {
      const r = await this.backendImpl.send({ to: out.channel.id, isGroup, text: part });
      if (!r.ok) {
        return {
          ok: false,
          error: { code: r.error?.code ?? "unknown", message: r.error?.message ?? "Send failed." },
        };
      }
      lastWamid = r.wamid;
    }
    return lastWamid !== undefined ? { ok: true, messageId: lastWamid } : { ok: true };
  }

  onInbound(handler: (event: GatewayMessageEvent) => Promise<void>): () => void {
    // EC-H: replace any previous subscription.
    this.inboundUnsubscribe?.();
    this.handler = handler;

    this.inboundUnsubscribe = this.backendImpl.onInbound(async (inbound) => {
      if (!this.handler) return;
      // D309 + EC-7: group filter with digit-only normalization.
      if (inbound.conversationType === "group" && this.requireMention) {
        if (this.botPhoneId.length === 0) return; // misconfigured — drop silently
        const textDigits = digitsOnly(inbound.text);
        if (!textDigits.includes(this.botPhoneId)) return;
      }
      const event: WhatsAppMessageEvent = {
        id: inbound.wamid,
        platform: "whatsapp",
        sender: { id: inbound.fromPhone, displayName: inbound.contactName },
        channel: { id: inbound.channelId, type: inbound.conversationType },
        text: inbound.text,
        receivedAt: inbound.receivedAt,
        whatsapp: {
          wamid: inbound.wamid,
          phoneNumberId: inbound.phoneNumberId,
          contactName: inbound.contactName,
          backend: inbound.backend,
          raw: inbound.raw,
        },
      };
      await this.handler(event);
    });

    return () => {
      this.inboundUnsubscribe?.();
      this.inboundUnsubscribe = undefined;
      this.handler = undefined;
    };
  }

  /** Status receipts (sent/delivered/read/failed). Adapter-specific (D307). */
  onStatusReceipt(handler: (receipt: WhatsAppStatusReceipt) => Promise<void>): () => void {
    this.statusUnsubscribe?.();
    this.statusHandler = handler;
    this.statusUnsubscribe = this.backendImpl.onStatusReceipt(async (r) => {
      await this.statusHandler?.(r);
    });
    return () => {
      this.statusUnsubscribe?.();
      this.statusUnsubscribe = undefined;
      this.statusHandler = undefined;
    };
  }
}

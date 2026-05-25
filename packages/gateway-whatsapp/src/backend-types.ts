/**
 * Backend abstraction (ADR D303). Lets `WhatsAppAdapter` stay backend-agnostic
 * while we ship both Cloud (Meta API) and Web (`whatsapp-web.js` subprocess)
 * implementations side by side.
 *
 * @internal
 */

/**
 * Sentinel runtime export — prevents rollup-plugin-dts from treating this
 * file as a pure-types module (workaround for a bundler quirk with deeply
 * re-exported types). Not used at runtime.
 *
 * @knipignore
 */
export const __backendTypesMarker: unique symbol = Symbol("backend-types");

/** Normalized inbound event — cloud + web both produce this shape. */
export interface WhatsAppInboundEvent {
  /** Stable message id (`wamid.xxx` cloud, `msg.id._serialized` web). */
  readonly wamid: string;
  /** Sender phone (digits only — no `+` prefix). */
  readonly fromPhone: string;
  /** Cloud-only Meta phone-number-id; undefined for web. */
  readonly phoneNumberId?: string;
  /** Display name when available. */
  readonly contactName?: string;
  /** Conversation type. */
  readonly conversationType: "dm" | "group";
  /** Channel id — either the sender phone (DM) or the group id (group). */
  readonly channelId: string;
  /** Plain-text body (already filtered by EC-4 — text-only in v1). */
  readonly text: string;
  /** Receipt timestamp (ms since epoch). */
  readonly receivedAt: number;
  /** Backend that emitted this event. */
  readonly backend: "cloud" | "web";
  /** Raw envelope for the escape hatch. */
  readonly raw: unknown;
}

/** Outbound message — what `WhatsAppBackend.send` accepts. */
export interface WhatsAppOutboundMessage {
  /** Phone (digits, E.164 minus `+`) or group id. */
  readonly to: string;
  /** Whether `to` is a group id (cloud needs different shape; web is implicit). */
  readonly isGroup: boolean;
  /** Plain-text body (already split for 4096-char cap). */
  readonly text: string;
}

/** Status receipt (ADR D307). */
export interface WhatsAppStatusReceipt {
  /** The `wamid` we previously sent. */
  readonly wamid: string;
  /** Delivery lifecycle stage. */
  readonly status: "sent" | "delivered" | "read" | "failed";
  /** Recipient (digits-only phone). */
  readonly recipient: string;
  /** Receipt timestamp. */
  readonly timestamp: number;
}

/** Per-message send result returned by `WhatsAppBackend.send`. */
export interface WhatsAppSendResult {
  readonly ok: boolean;
  /** Set when ok=true. The wamid Meta / web assigned to the outbound message. */
  readonly wamid?: string;
  readonly error?: {
    readonly code:
      | "auth_failed"
      | "rate_limit"
      | "invalid_request"
      | "server_error"
      | "timeout"
      | "unknown";
    readonly message: string;
  };
}

/**
 * Backend contract — every backend (cloud, web, future) implements this shape.
 * `WhatsAppAdapter` delegates lifecycle + send + subscribe through this seam.
 */
export interface WhatsAppBackend {
  readonly kind: "cloud" | "web";
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  send(message: WhatsAppOutboundMessage): Promise<WhatsAppSendResult>;
  /** Subscribe to normalized inbound events. Returns unsubscribe. */
  onInbound(handler: (event: WhatsAppInboundEvent) => Promise<void>): () => void;
  /** Subscribe to status receipts. Returns unsubscribe. */
  onStatusReceipt(handler: (receipt: WhatsAppStatusReceipt) => Promise<void>): () => void;
}

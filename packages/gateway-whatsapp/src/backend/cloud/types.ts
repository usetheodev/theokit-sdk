/**
 * Wire types for Meta WhatsApp Business Cloud API v18.0.
 * Hand-typed (ADR D304: no Meta SDK).
 *
 * @internal
 */

/** Send text request body. */
export interface MetaSendTextRequest {
  readonly messaging_product: "whatsapp";
  readonly recipient_type?: "individual";
  readonly to: string;
  readonly type: "text";
  readonly text: { readonly body: string; readonly preview_url?: boolean };
}

/** Send mark-as-read request body. */
export interface MetaMarkReadRequest {
  readonly messaging_product: "whatsapp";
  readonly status: "read";
  readonly message_id: string;
}

/** Send response on success. */
export interface MetaSendResponse {
  readonly messaging_product: "whatsapp";
  readonly contacts?: ReadonlyArray<{ readonly input: string; readonly wa_id: string }>;
  readonly messages: ReadonlyArray<{ readonly id: string; readonly message_status?: string }>;
}

/** Error envelope. */
export interface MetaErrorEnvelope {
  readonly error: {
    readonly message: string;
    readonly type?: string;
    readonly code: number;
    readonly error_subcode?: number;
    readonly fbtrace_id?: string;
  };
}

/** Inbound webhook payload — the full envelope Meta POSTs. */
export interface MetaWebhookEnvelope {
  readonly object: string;
  readonly entry: ReadonlyArray<MetaWebhookEntry>;
}

export interface MetaWebhookEntry {
  readonly id: string;
  readonly changes: ReadonlyArray<MetaWebhookChange>;
}

export interface MetaWebhookChange {
  readonly value: MetaWebhookValue;
  readonly field: string;
}

export interface MetaWebhookValue {
  readonly messaging_product: "whatsapp";
  readonly metadata: { readonly display_phone_number: string; readonly phone_number_id: string };
  readonly contacts?: ReadonlyArray<{
    readonly profile: { readonly name?: string };
    readonly wa_id: string;
  }>;
  readonly messages?: ReadonlyArray<MetaIncomingMessage>;
  readonly statuses?: ReadonlyArray<MetaStatusUpdate>;
}

export interface MetaIncomingMessage {
  readonly from: string;
  readonly id: string;
  readonly timestamp: string;
  readonly type: string; // "text", "image", "audio", etc.
  readonly text?: { readonly body: string };
  readonly context?: { readonly from: string; readonly id: string };
}

export interface MetaStatusUpdate {
  readonly id: string;
  readonly status: "sent" | "delivered" | "read" | "failed";
  readonly timestamp: string;
  readonly recipient_id: string;
}

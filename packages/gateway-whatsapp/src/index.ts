/**
 * `@usetheo/gateway-whatsapp` — public API.
 *
 * Multi-backend (Cloud + Web) WhatsApp adapter for `@usetheo/gateway`.
 * See README for setup walkthroughs.
 *
 * @public
 */

export {
  digitsOnly,
  WhatsAppAdapter,
  type WhatsAppAdapterOptions,
  type WhatsAppCloudConfig,
  type WhatsAppWebConfig,
} from "./adapter.js";

export type {
  WhatsAppBackend,
  WhatsAppInboundEvent,
  WhatsAppOutboundMessage,
  WhatsAppSendResult,
  WhatsAppStatusReceipt,
} from "./backend-types.js";

export { splitForWhatsApp } from "./split.js";

// Cloud backend (Meta WhatsApp Business Cloud API).
export {
  WhatsAppCloudBackend,
  type WhatsAppCloudBackendOptions,
} from "./backend/cloud/index.js";

// Web bridge backend (whatsapp-web.js subprocess).
export {
  WhatsAppWebBackend,
  type WhatsAppWebBackendOptions,
} from "./backend/web/index.js";

// IPC helpers (advanced — typically not needed unless writing a custom bridge).
export {
  formatCommand,
  type IpcCommand,
  type IpcEvent,
  LineBuffer,
  parseEvent,
} from "./backend/web/ipc.js";

// Webhook helpers (caller wires into their HTTP route).
export {
  normalizeInboundMessages,
  normalizeStatusReceipts,
  parseWebhookPayload,
  verifyWebhookSignature,
  verifyWebhookSubscription,
} from "./backend/cloud/webhook.js";

// Errors.
export {
  mapWhatsAppCloudError,
  mapWhatsAppWebError,
  WhatsAppConnectTimeoutError,
} from "./errors.js";

// Re-export the MessageEvent variant for consumer-side ergonomics.
export type { WhatsAppMessageEvent } from "@usetheo/gateway";

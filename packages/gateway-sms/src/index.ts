// Public API for @usetheo/gateway-sms (ADRs D389-D396).

export { SMSAdapter } from "./adapter.js";
export { BackendNotInstalledError, ConfigurationError } from "./errors.js";
export { normalizeE164 } from "./phone.js";
export { splitForSMS } from "./split.js";
export type {
  PlivoOptions,
  SMSAdapterOptions,
  TwilioOptions,
  VonageOptions,
} from "./types.js";
export type { WebhookServer, WebhookServerOptions } from "./webhook-server.js";
export { createWebhookServer } from "./webhook-server.js";

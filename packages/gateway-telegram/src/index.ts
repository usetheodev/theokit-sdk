// @usetheo/gateway-telegram — public API.
// Implementation lands in Phase 5 (T5.1) of the gateway-v0.1 plan.

export { TelegramAdapter, type TelegramAdapterOptions } from "./adapter.js";
export {
  type PolicyContext,
  shouldRespondInChat,
  stripBotMention,
} from "./group-policy.js";
export { splitForTelegram } from "./split.js";

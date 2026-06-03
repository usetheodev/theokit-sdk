// Public API for @theokit/gateway (Hermes #gateway-port, ADRs D170-D181).

// Adapter contract
export {
  BasePlatformAdapter,
  type OutboundMessage,
  type SendResult,
} from "./adapter/base.js";
// Delivery
export {
  type DeliveryRequest,
  DeliveryRouter,
  type DeliveryTarget,
} from "./delivery/router.js";
// Hooks
export {
  type GatewayHook,
  type HookDecision,
  HookExecutor,
  type HookName,
  type OnErrorContext,
  type PostOutboundContext,
  type PreInboundContext,
} from "./hooks/types.js";
// Runner
export {
  type GatewayContext,
  type GatewayHandler,
  GatewayRunner,
  type GatewayRunnerOptions,
} from "./runner/gateway-runner.js";
// Session
export {
  type AgentIdStrategy,
  defaultStrategy,
  SessionRouter,
} from "./session/router.js";
// Types
export type {
  BaseMessageEvent,
  DiscordMessageEvent,
  EmailMessageEvent,
  LineMessageEvent,
  MatrixMessageEvent,
  MattermostMessageEvent,
  MessageEvent,
  PlatformName,
  SlackMessageEvent,
  SMSMessageEvent,
  TeamsMessageEvent,
  TelegramMessageEvent,
  WhatsAppMessageEvent,
} from "./types/message-event.js";

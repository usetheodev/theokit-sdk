/**
 * `@theokit/sdk-handoff` — inter-agent dispatch for `@theokit/sdk`.
 *
 * Extracted from `@theokit/sdk@1.7.0` as part of the SDK 2.0 package split
 * (Phase 4 / T4.1). Integrates with `Agent` via the Plugin protocol —
 * `Handoff.asPlugin({ targets })` returns a `Plugin` consumed by
 * `Agent.create({ plugins: [...] })`.
 *
 * @packageDocumentation
 */

export {
  type AsPluginOptions,
  Handoff,
  handoffTo,
  RECOMMENDED_HANDOFF_PROMPT_PREFIX,
} from "./handoff.js";
export type { HandoffDescriptor, HandoffOptions } from "./types/handoff.js";
export {
  HandoffLoopError,
  HandoffNameCollisionError,
  HandoffPairLoopError,
  HandoffReceiverDisposedError,
  HandoffSelfReferenceError,
} from "./types/handoff.js";

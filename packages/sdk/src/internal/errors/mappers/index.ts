/**
 * Barrel for provider-specific HTTP error mappers (ADR D67).
 *
 * @internal
 */

export { mapAnthropicError } from "./anthropic.js";
export { mapOpenAICompatibleError } from "./openai-compatible.js";

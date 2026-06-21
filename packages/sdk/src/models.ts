/**
 * `@theokit/sdk/models` — per-model capability catalog.
 *
 * `resolveModelCapabilities(modelId)` returns a model's capability flags +
 * `maxContextTokens`/`maxOutputTokens` from a static, OFFLINE catalog (pure,
 * sync, no network). It strips routing prefixes (`openrouter/`/`vertex/`/
 * `bedrock/`) and OpenRouter `:variant` suffixes before lookup; unknown models
 * get conservative defaults. The `maxContextTokens` value feeds the pre-call
 * `shouldCompact` helper on `@theokit/sdk/compaction`.
 */

export {
  type ModelCapabilities,
  resolveModelCapabilities,
} from "./internal/llm/model-capabilities.js";

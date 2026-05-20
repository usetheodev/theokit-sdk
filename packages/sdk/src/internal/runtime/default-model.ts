/**
 * Default agentic model id used when callers create an agent without
 * explicitly setting `model`. Picked from OpenRouter's free tier so a fresh
 * SDK install with `OPENROUTER_API_KEY` set works out-of-the-box. Has solid
 * tool-calling for agentic flows (memory tools, MCP, hooks, subagents).
 *
 * Override per-agent via `Agent.create({ model: { id: "..." } })` or
 * per-send via `agent.send(msg, { model: { id: "..." } })`. Real
 * provider-side model selection is determined by the API key chosen — this
 * id is the label embedded in run metadata + the value forwarded when the
 * runtime hits OpenRouter directly.
 *
 * @internal
 */
export const DEFAULT_AGENTIC_MODEL_ID = "google/gemini-2.0-flash-001";

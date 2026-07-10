/**
 * Type-leaf — primitives shared between `agent.ts`, `run.ts`, and
 * `messages.ts`. Extracted to break LOW type-only cycles #5 and #7
 * (audit `architecture-output/final_report.md`) per plan
 * arch-review-fixes-2026-06-06 § Phase 4 / T4.1 (D438).
 *
 * Public surface unchanged — `types/agent.ts` re-exports these from this
 * leaf so `import type { ModelSelection, CustomTool } from "@theokit/sdk"`
 * keeps resolving.
 *
 * @public
 */

/**
 * One slot in a {@link ModelSelection.params} array.
 *
 * @public
 */
export interface ModelParameterValue {
  id: string;
  value: string;
}

/**
 * Identifies a model plus optional per-model parameters (e.g. reasoning effort).
 *
 * Use `Theokit.models.list()` to discover valid ids and parameter definitions.
 *
 * @public
 */
export interface ModelSelection {
  id: string;
  params?: ModelParameterValue[];
}

/**
 * SE12 — a read-only, text-only projection of one turn of the run's conversation,
 * exposed to a tool handler via `ctx.messages`. Content is flattened to text; tool
 * calls / results and non-text parts are dropped, and turns that project to empty
 * text are omitted. Consumed by `defineSubAgent`'s `messageFilter` to forward
 * (a subset of) the supervisor transcript to a subagent.
 *
 * `role` includes `"system"` for type-completeness with the wire message shape,
 * but the system prompt travels on a separate request field — a `"system"` entry
 * does NOT appear in the current projection.
 *
 * @public
 */
export interface ToolContextMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Local function tool declared per-agent via {@link AgentOptions.tools}. The
 * handler runs in-process; no MCP server is involved. The SDK serializes
 * `name`, `description`, and `inputSchema` into the model's tool catalog.
 *
 * Handlers MUST be re-passed on `Agent.resume()` because closures cannot be
 * persisted. The tool catalog (name + description + schema) is NOT serialized.
 *
 * @public
 */
export interface CustomTool {
  /**
   * Tool name surfaced to the LLM. Must match `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`
   * and must not collide with `shell`, `memory_search`, `memory_get`, or any
   * `mcp_*` prefix (reserved for the SDK's built-in tools).
   */
  name: string;
  /** Description surfaced to the LLM. Required — drives tool-selection accuracy. */
  description: string;
  /** JSON Schema (Draft-7 subset) describing the `input` argument. Must be `type: "object"`. */
  inputSchema: Record<string, unknown>;
  /**
   * Local handler invoked when the model emits `tool_use` for this tool.
   * Returns a string OR structured content blocks (SE7 — text + image, e.g. a
   * screenshot) that become the `tool_result.content` surfaced back to the
   * model. Throws → SDK converts to `tool_result` with `isError: true` and the
   * error `message` as content; throw a `ToolError` to carry a clean message or
   * multimodal error content. #65 — an optional 2nd `ToolContext` argument
   * carries the run's `AbortSignal`; single-argument handlers are unaffected. M7
   * — the same `ctx` also carries an optional user `context` (provided once via
   * `SendOptions.context`), so shared config like a `projectRoot` is read by
   * every tool instead of baked into each factory. SE12 — `ctx.messages` is a
   * read-only, text-only projection of the current turn's transcript (see
   * {@link ToolContextMessage}); `defineSubAgent`'s `messageFilter` consumes it.
   */
  handler: (
    input: Record<string, unknown>,
    ctx?: { signal?: AbortSignal; context?: unknown; messages?: readonly ToolContextMessage[] },
  ) =>
    | string
    | import("./content-blocks.js").ToolResultContentBlock[]
    | Promise<string | import("./content-blocks.js").ToolResultContentBlock[]>;
}

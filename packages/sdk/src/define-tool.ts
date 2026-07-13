// `zod` referenced only as a TYPE — `import type` is erased by tsc/tsup, so
// the compiled `dist/index.js` does NOT have a top-level `import "zod"`.
// Consumers who don't call `defineTool` don't need `zod` installed (the peer
// dependency stays truly optional per ADR D24). The runtime JSON-Schema
// conversion uses Zod v4's native `z.toJSONSchema()` via the internal shim.
import type { z as ZodNamespace, ZodType } from "zod";

import { toJsonSchema } from "./internal/zod/to-json-schema.js";
import { sanitizeToolInput } from "./sanitize/sanitize-tool-input.js";
import type { SanitizeOptions } from "./sanitize/types.js";
import type { CustomTool } from "./types/agent.js";
import type { ToolResultContentBlock } from "./types/content-blocks.js";

/**
 * Spec accepted by {@link defineTool}. `inputSchema` is a Zod schema; the
 * `handler` argument type is inferred via `z.infer<T>` — no `as` casts.
 *
 * @public
 */
/**
 * SE16 — the handler's return type. With no `outputSchema` the tool returns a
 * plain `string` (pre-SE16 shape). With an `outputSchema` the handler returns the
 * STRUCTURED output inferred from it (validated + serialized to the tool result).
 * The `[O]` tuple wrap prevents distribution so `never` maps cleanly to `string`.
 */
type ToolHandlerReturn<O extends ZodType> = [O] extends [never] ? string : ZodNamespace.infer<O>;

export interface DefineToolSpec<T extends ZodType, O extends ZodType = never> {
  /** Tool name surfaced to the LLM. Same constraints as {@link CustomTool.name}. */
  name: string;
  /** Description surfaced to the LLM. */
  description: string;
  /** Zod schema describing the input. Must be `z.object(...)` at the root for the LLM tool contract. */
  inputSchema: T;
  /**
   * SE16 — optional Zod schema describing the OUTPUT. When set, the handler
   * returns the structured value inferred from it; the value is validated against
   * this schema and serialized to the tool result (a string stays as-is, an object
   * is JSON-stringified). A validation failure raises `ZodError`, converted to a
   * `tool_result(isError)`. Absent ⇒ the handler returns a plain string (unchanged).
   */
  outputSchema?: O;
  /**
   * Handler invoked with the parsed input. Type is inferred via `z.infer<T>`; the
   * return type is `z.infer<O>` when `outputSchema` is set, else `string`.
   * #65 — an optional 2nd `ToolContext` argument carries the run's `AbortSignal`,
   * so a cooperative handler can stop early when the run is cancelled. Existing
   * single-argument handlers are unaffected.
   */
  handler: (
    input: ZodNamespace.infer<T>,
    ctx?: { signal?: AbortSignal; context?: unknown },
  ) => ToolHandlerReturn<O> | Promise<ToolHandlerReturn<O>>;
  /**
   * SE17 — map the handler's (validated) output to the compact / multimodal
   * representation the MODEL sees in the tool_result. The handler keeps returning
   * the FULL result (validated by `outputSchema`); `toModelOutput` shapes only what
   * reaches the model, so app-facing detail is not forced into model context.
   * Returns a string OR SE7 `ToolResultContentBlock[]` (text + image). Absent ⇒
   * the tool_result is the serialized handler output (SE16 / pre-SE17 behavior).
   * Note: observability (`onToolEnd`) sees the model-facing result this returns,
   * not the raw handler output — the full result lives in the handler's own scope.
   */
  toModelOutput?: (output: ToolHandlerReturn<O>) => string | ToolResultContentBlock[];
  /**
   * Sanitize the raw model-emitted args BEFORE schema validation (`@theokit/sdk/sanitize`).
   * `true` trims whitespace; an object opts into coercion / JSON-repair. Coercion is schema-aware
   * against this tool's `inputSchema`. Absent ⇒ args reach validation untouched. Sanitize is
   * hygiene, not a validity bypass — a genuinely invalid arg still raises `ZodError`.
   */
  sanitize?: boolean | SanitizeOptions;
}

/**
 * Type-safe builder for {@link CustomTool}. Converts a Zod schema to JSON
 * Schema (for the LLM-facing `inputSchema` field), wraps the handler with a
 * runtime `schema.parse` step, and preserves type inference.
 *
 * Behaviour (ADR D24):
 * - JSON Schema conversion uses Zod 4's native `z.toJSONSchema` with
 *   `unrepresentable: "any"` so transforms/refinements round-trip.
 * - Runtime parse failures throw `ZodError`; the SDK's tool-dispatch converts
 *   them to `tool_result(isError)` with the Zod message.
 * - Handler signature is `(input: z.infer<T>)`, not `Record<string, unknown>`.
 * - `zod` loads lazily via `createRequire` — consumers who don't call
 *   `defineTool` don't need `zod` installed.
 *
 * @public
 */
/**
 * SE16 + SE17 — validate the handler's output against `outputSchema` (if any), then
 * shape the tool_result: `toModelOutput` maps it to the model-facing string/blocks,
 * else it is serialized (string as-is, else JSON). The FULL result stays with the handler.
 */
function shapeToolResult<T extends ZodType, O extends ZodType>(
  spec: DefineToolSpec<T, O>,
  out: ToolHandlerReturn<O>,
): string | ToolResultContentBlock[] {
  // `parse(out)` returns `z.infer<O>` ≡ `ToolHandlerReturn<O>` when `O ≠ never`; the
  // cast closes the conditional-type gap the compiler can't narrow through here.
  const validated = (
    spec.outputSchema === undefined ? out : spec.outputSchema.parse(out)
  ) as ToolHandlerReturn<O>;
  if (spec.toModelOutput !== undefined) return spec.toModelOutput(validated);
  return typeof validated === "string" ? validated : JSON.stringify(validated);
}

/**
 * SE36 — the uniform `X.create()` namespace API. `Tool.create(spec)` is the sole public
 * constructor for a {@link CustomTool}; it wraps the internal builder so behavior is identical
 * (ADR 0015). A `private constructor` makes `Tool` a namespace, not an instantiable value —
 * `new Tool()` is a compile error. Mirrors `Agent.create` / `Cron.create`.
 *
 * @public
 */
export class Tool {
  private constructor() {}
  static create<T extends ZodType, O extends ZodType = never>(
    spec: DefineToolSpec<T, O>,
  ): CustomTool {
    return defineTool(spec);
  }
}

function defineTool<T extends ZodType, O extends ZodType = never>(
  spec: DefineToolSpec<T, O>,
): CustomTool {
  // Zod v4 native JSON Schema converter via internal shim.
  // `unrepresentable: "any"` lets transforms / refinements / branded types
  // round-trip to JSON Schema as `{}` (effectively `any`). The runtime parse
  // still enforces the full Zod contract; the LLM just sees a looser hint.
  const inputSchema = toJsonSchema(spec.inputSchema, {
    unrepresentable: "any",
  });
  return {
    name: spec.name,
    description: spec.description,
    inputSchema,
    handler: async (
      input: Record<string, unknown>,
      ctx?: { signal?: AbortSignal; context?: unknown },
    ): Promise<string | ToolResultContentBlock[]> => {
      const raw = spec.sanitize
        ? sanitizeToolInput(input, {
            ...(spec.sanitize === true ? {} : spec.sanitize),
            schema: spec.inputSchema,
          }).value
        : input;
      const parsed = spec.inputSchema.parse(raw) as ZodNamespace.infer<T>;
      // #65 — forward the ToolContext (run signal) to the user's handler.
      const out = await spec.handler(parsed, ctx);
      // SE16 (validate) + SE17 (toModelOutput / serialize) — see `shapeToolResult`.
      return shapeToolResult(spec, out);
    },
  };
}

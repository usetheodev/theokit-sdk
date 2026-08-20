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
 * Spec accepted by {@link Tool.create}. `inputSchema` is a Zod schema; the
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
    ctx?: { signal?: AbortSignal; context?: unknown; threadId?: string },
  ) => ToolHandlerReturn<O> | Promise<ToolHandlerReturn<O>>;
  /**
   * SE17 — map the handler's (validated) output to the compact / multimodal
   * representation the MODEL sees in the tool_result. The handler keeps returning
   * the FULL result (validated by `outputSchema`); `toModelOutput` shapes only what
   * reaches the model, so app-facing detail is not forced into model context.
   * Returns a string OR SE7 `ToolResultContentBlock[]` (text + image). Absent ⇒
   * the tool_result is the serialized handler output (SE16 / pre-SE17 behavior).
   * The split is REAL: the model's `tool_result` carries this compact value, while
   * observability (`onToolEnd.result`) receives the FULL raw handler output
   * (serialized) — so the app keeps the complete result. ONE handler execution
   * feeds both channels.
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
 * SE17 — symbol under which a `toModelOutput` tool carries its model/app SPLIT
 * resolver on the built `CustomTool.handler` function. The runtime tool dispatch
 * (`tool-executors.ts`) prefers this resolver so it can route the FULL raw output
 * to observability (`onToolEnd`) while the compact `toModelOutput` result goes to
 * the model's `tool_result`. Absent ⇒ the plain handler return is used for both
 * (pre-SE17 behavior). A hidden symbol (not a public `CustomTool` field) mirrors
 * the `INHERIT_CREDENTIALS` pattern — the split is an internal wire concern.
 * @internal
 */
export const TOOL_SPLIT_RESOLVER: unique symbol = Symbol("theokit.toolSplitResolver");

/** @internal — the two channels a `toModelOutput` tool produces from ONE handler run. */
export interface ToolOutputSplit {
  /** What the MODEL sees in the `tool_result` (compact / multimodal). */
  model: string | ToolResultContentBlock[];
  /** What the APP / observability keeps (the full raw handler output, serialized). */
  app: string | ToolResultContentBlock[];
}

/** @internal — a handler carrying an SE17 split resolver. */
export type SplitResolver = (
  input: Record<string, unknown>,
  ctx?: { signal?: AbortSignal; context?: unknown; threadId?: string },
) => Promise<ToolOutputSplit>;

/**
 * Run the input pipeline (sanitize → parse → handler → `outputSchema` validate)
 * and return the FULL VALIDATED structured output — the single source both output
 * channels derive from. Kept separate so the public handler and the SE17 split
 * resolver share ONE handler execution.
 */
async function runValidated<T extends ZodType, O extends ZodType>(
  spec: DefineToolSpec<T, O>,
  input: Record<string, unknown>,
  ctx?: { signal?: AbortSignal; context?: unknown; threadId?: string },
): Promise<ToolHandlerReturn<O>> {
  const raw = spec.sanitize
    ? sanitizeToolInput(input, {
        ...(spec.sanitize === true ? {} : spec.sanitize),
        schema: spec.inputSchema,
      }).value
    : input;
  const parsed = spec.inputSchema.parse(raw) as ZodNamespace.infer<T>;
  // #65 — forward the ToolContext (run signal / user context) to the user's handler.
  const out = await spec.handler(parsed, ctx);
  // `parse(out)` returns `z.infer<O>` ≡ `ToolHandlerReturn<O>` when `O ≠ never`; the
  // cast closes the conditional-type gap the compiler can't narrow through here.
  return (
    spec.outputSchema === undefined ? out : spec.outputSchema.parse(out)
  ) as ToolHandlerReturn<O>;
}

/** Serialize a validated output to a tool_result string (string as-is, else JSON). */
function serializeOutput(validated: unknown): string {
  return typeof validated === "string" ? validated : JSON.stringify(validated);
}

/**
 * SE16 + SE17 — from the validated output, produce the MODEL-facing tool_result:
 * `toModelOutput` maps it to the compact string/blocks, else it is serialized.
 */
function shapeModelOutput<T extends ZodType, O extends ZodType>(
  spec: DefineToolSpec<T, O>,
  validated: ToolHandlerReturn<O>,
): string | ToolResultContentBlock[] {
  if (spec.toModelOutput !== undefined) return spec.toModelOutput(validated);
  return serializeOutput(validated);
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
  const handler = async (
    input: Record<string, unknown>,
    ctx?: { signal?: AbortSignal; context?: unknown; threadId?: string },
  ): Promise<string | ToolResultContentBlock[]> => {
    // SE16 (validate) + SE17 (model-facing shaping). A direct caller gets the
    // MODEL-facing value — unchanged pre/post SE17-split.
    const validated = await runValidated(spec, input, ctx);
    return shapeModelOutput(spec, validated);
  };
  const tool: CustomTool = { name: spec.name, description: spec.description, inputSchema, handler };
  // SE17 gap closure — when `toModelOutput` is set, attach the split resolver so
  // the runtime routes the FULL raw output to `onToolEnd` while the model sees the
  // compact value. ONE handler execution feeds both channels (`runValidated`).
  if (spec.toModelOutput !== undefined) {
    const resolver: SplitResolver = async (input, ctx) => {
      const validated = await runValidated(spec, input, ctx);
      return { model: shapeModelOutput(spec, validated), app: serializeOutput(validated) };
    };
    (handler as unknown as Record<symbol, SplitResolver>)[TOOL_SPLIT_RESOLVER] = resolver;
  }
  return tool;
}

// `zod` referenced only as a TYPE — `import type` is erased by tsc/tsup, so
// the compiled `dist/index.js` does NOT have a top-level `import "zod"`.
// Consumers who don't call `defineTool` don't need `zod` installed (the peer
// dependency stays truly optional per ADR D24). The runtime JSON-Schema
// conversion is delegated to `zodToJsonSchema` (internal/zod/to-json-schema)
// which feature-detects zod 4 native `toJSONSchema` vs zod 3 +
// `zod-to-json-schema` peer dep — supporting the SDK's declared peer range
// `zod: "^3.25.0 || ^4.0.0"`.
import type { z as ZodNamespace, ZodType } from "zod";

import { toJsonSchema } from "./internal/zod/to-json-schema.js";
import type { CustomTool } from "./types/agent.js";

/**
 * Spec accepted by {@link defineTool}. `inputSchema` is a Zod schema; the
 * `handler` argument type is inferred via `z.infer<T>` — no `as` casts.
 *
 * @public
 */
export interface DefineToolSpec<T extends ZodType> {
  /** Tool name surfaced to the LLM. Same constraints as {@link CustomTool.name}. */
  name: string;
  /** Description surfaced to the LLM. */
  description: string;
  /** Zod schema describing the input. Must be `z.object(...)` at the root for the LLM tool contract. */
  inputSchema: T;
  /** Handler invoked with the parsed input. Type is inferred via `z.infer<T>`. */
  handler: (input: ZodNamespace.infer<T>) => string | Promise<string>;
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
export function defineTool<T extends ZodType>(spec: DefineToolSpec<T>): CustomTool {
  // Universal Zod → JSON Schema converter (feature-detects zod 4 native
  // `z.toJSONSchema` vs zod 3 + `zod-to-json-schema` peer). Fixes the bug
  // where consumers pinned to `zod@^3.25.0` (no native `toJSONSchema`) hit
  // `z.toJSONSchema is not a function` at runtime. The SDK declares
  // peer `zod: "^3.25.0 || ^4.0.0"` — both must work.
  //
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
    handler: async (input: Record<string, unknown>): Promise<string> => {
      const parsed = spec.inputSchema.parse(input) as ZodNamespace.infer<T>;
      return await spec.handler(parsed);
    },
  };
}

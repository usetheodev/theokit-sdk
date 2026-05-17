import { createRequire } from "node:module";

// `zod` referenced only as a TYPE — `import type` is erased by tsc/tsup, so
// the compiled `dist/index.js` does NOT have a top-level `import "zod"`.
// Consumers who don't call `defineTool` don't need `zod` installed (the peer
// dependency stays truly optional per ADR D24). The runtime `z` namespace
// is loaded SYNCHRONOUSLY via `createRequire` on the first defineTool call;
// this preserves the sync API contract from D25 (defineTool is not async)
// while keeping the zod import lazy.
import type { z as ZodNamespace, ZodType } from "zod";

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

/** Cached zod namespace after the first `require("zod")`. */
let cachedZ: typeof ZodNamespace | undefined;

/**
 * Synchronously load `zod` on demand. Uses `createRequire` so the call works
 * in both ESM and CJS dist output. Throws a clear error if `zod` isn't
 * installed — meaning the consumer used `defineTool` without adding the peer
 * dep to their `package.json`.
 */
function requireZod(): typeof ZodNamespace {
  if (cachedZ !== undefined) return cachedZ;
  // import.meta.url is the SDK's own module URL — createRequire here resolves
  // `zod` against the SDK's node_modules tree, which is exactly what we want.
  const r = createRequire(import.meta.url);
  let mod: { z?: typeof ZodNamespace } & typeof ZodNamespace;
  try {
    mod = r("zod") as typeof mod;
  } catch (cause) {
    throw new Error(
      "defineTool() requires the optional peer dependency `zod` to be installed. " +
        'Add `"zod": "^3.25.0 || ^4.0.0"` to your package.json and reinstall. ' +
        `Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  // Zod 4 exposes `z` as a namespace export AND re-exports schema constructors
  // at the module root. Prefer `z` if present.
  cachedZ = (mod.z ?? mod) as typeof ZodNamespace;
  return cachedZ;
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
  const z = requireZod();
  // `unrepresentable: "any"` lets transforms / refinements / branded types
  // round-trip to JSON Schema as `{}` (effectively `any`). The runtime parse
  // still enforces the full Zod contract; the LLM just sees a looser hint.
  const inputSchema = z.toJSONSchema(spec.inputSchema, {
    unrepresentable: "any",
  }) as Record<string, unknown>;
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

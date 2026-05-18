import { createRequire } from "node:module";
import type { z as ZodNamespace, ZodType } from "zod";
import { ConfigurationError } from "../errors.js";

import type { AgentOptions, CustomTool, LocalOptions, ModelSelection } from "../types/agent.js";

/**
 * Shared helpers for `Agent.generateObject` (ADR D33) and
 * `Agent.streamObject` (ADR D39). Both build a transient agent with a
 * single synthetic `output` tool whose handler captures the model's
 * structured response.
 *
 * Extracted from inline duplicates to keep jscpd quiet AND to keep the
 * two public APIs in lockstep.
 *
 * @internal
 */

let cachedZ: typeof ZodNamespace | undefined;

/**
 * Load Zod via createRequire (it's an optional peer dep). Throws a typed
 * ConfigurationError if Zod isn't installed.
 */
export function requireZod(): typeof ZodNamespace {
  if (cachedZ !== undefined) return cachedZ;
  const r = createRequire(import.meta.url);
  let mod: { z?: typeof ZodNamespace } & typeof ZodNamespace;
  try {
    mod = r("zod") as typeof mod;
  } catch (cause) {
    throw new ConfigurationError(
      "Structured output requires the optional peer dependency `zod`. " +
        'Add `"zod": "^3.25.0 || ^4.0.0"` to your package.json and reinstall.',
      { code: "zod_not_installed", cause },
    );
  }
  cachedZ = (mod.z ?? mod) as typeof ZodNamespace;
  return cachedZ;
}

/**
 * Build the synthetic `output` tool used by both `generateObject` and
 * `streamObject`. The handler captures the raw input on first call only
 * (EC-D10 / EC-6: parallel tool use in Claude 3.5+ may invoke `output`
 * twice; later calls are ignored).
 */
export function makeOutputTool(
  jsonSchema: Record<string, unknown>,
  onCapture: (input: unknown) => string | Promise<string> | undefined,
): CustomTool {
  return {
    name: "output",
    description: "Call this tool with your final structured answer. Match the JSON schema exactly.",
    inputSchema: jsonSchema,
    handler: (input) => {
      const out = onCapture(input);
      // Some callers throw a sentinel (generate-object) and never return.
      // Others return a string (stream-object). Anything else → empty string.
      if (typeof out === "string") return out;
      if (out instanceof Promise) return out;
      return "";
    },
  };
}

/**
 * Assemble the AgentOptions for the transient agent. Shared shape:
 * model + local + tools[output] + systemPrompt + apiKey.
 */
export function buildTransientAgentOptions(params: {
  model: ModelSelection;
  local: LocalOptions;
  outputTool: CustomTool;
  systemPrompt?: string;
  apiKey?: string;
}): AgentOptions {
  return {
    model: params.model,
    local: params.local,
    tools: [params.outputTool],
    systemPrompt:
      params.systemPrompt ??
      "You produce structured output by calling the `output` tool exactly once. Match the JSON schema.",
    ...(params.apiKey !== undefined ? { apiKey: params.apiKey } : {}),
  };
}

/**
 * Best-effort extraction of token usage from a run result. Local runtimes
 * may not expose it; default to zeros.
 */
export function extractUsage(result: unknown): { inputTokens: number; outputTokens: number } {
  const u = (result as { usage?: { inputTokens?: number; outputTokens?: number } }).usage;
  if (u === undefined) return { inputTokens: 0, outputTokens: 0 };
  return { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0 };
}

/**
 * Build the user-message prompt that instructs the model to call the
 * `output` tool with a schema-matched structured answer.
 */
export function buildToolPrompt(prompt: string): string {
  return `${prompt}\n\nRespond by calling the \`output\` tool with the structured answer that matches the schema.`;
}

/**
 * One-shot setup shared by both `generateObject` and `streamObject`. Loads
 * Zod, computes the JSON schema, primes the captured-raw / usage / retry
 * state. Returns the values needed by the caller's loop.
 */
export function setupStructuredOutput<T extends ZodType>(
  schema: T,
  maxRetries: number | undefined,
) {
  const z = requireZod();
  const jsonSchema = z.toJSONSchema(schema, {
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return {
    z,
    jsonSchema,
    maxRetries: maxRetries ?? 1,
    initialUsage: { inputTokens: 0, outputTokens: 0 },
  };
}

/**
 * Cleanup the transient agent after generateObject/streamObject finish.
 * Disposes AND hard-deletes from the registry so the count stays stable.
 *
 * @internal
 */
export async function disposeAndDeleteTransient(
  agent: { dispose: () => Promise<void>; agentId: string },
  deletor: (agentId: string) => Promise<void>,
): Promise<void> {
  await agent.dispose();
  try {
    await deletor(agent.agentId);
  } catch {
    // Best-effort cleanup.
  }
}

void (null as unknown as ZodType); // satisfies unused-import check

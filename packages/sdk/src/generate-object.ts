import type { z as ZodNamespace, ZodType } from "zod";

import {
  buildToolPrompt,
  buildTransientAgentOptions,
  disposeAndDeleteTransient,
  extractUsage,
  makeOutputTool,
  setupStructuredOutput,
} from "./internal/structured-output-helpers.js";
import type { AgentOptions, LocalOptions, ModelSelection, SDKAgent } from "./types/agent.js";

/**
 * Options accepted by {@link Agent.generateObject}. Returns a typed object
 * matching the supplied Zod schema. See ADR D33.
 *
 * @public
 */
export interface GenerateObjectOptions<T extends ZodType> {
  /** Zod schema describing the expected object shape. */
  schema: T;
  /** User prompt — the model is asked to fill the schema given this prompt. */
  prompt: string;
  /** Optional system prompt steering the model. */
  systemPrompt?: string;
  /** Model selection. Required (transient agents need a model). */
  model: ModelSelection;
  /** API key. Falls back to env (THEOKIT_API_KEY etc). */
  apiKey?: string;
  /** Local runtime config (cwd, sandbox). Required to keep the transient agent local-only. */
  local: LocalOptions;
  /**
   * Retry budget on parse failures. Default 1 (initial attempt + 1 retry).
   * The transient agent is REUSED across retries so the registry sees a
   * single entry (EC-3).
   */
  maxRetries?: number;
}

/**
 * Successful return from {@link Agent.generateObject}.
 *
 * @public
 */
export interface GenerateObjectResult<T> {
  /** Typed object parsed via the Zod schema. */
  object: T;
  /** Raw input the model passed to the synthetic tool, before Zod parse. */
  raw: unknown;
  /** Token usage of the LLM call(s) that produced the result. */
  usage: { inputTokens: number; outputTokens: number };
  /** Stop reason of the underlying agent run. */
  finishReason: "tool_use" | "error";
}

/**
 * Typed error thrown by {@link Agent.generateObject} when the model refuses
 * to call the synthetic `output` tool or when retries are exhausted.
 *
 * @public
 */
export class GenerateObjectError extends Error {
  override readonly name = "GenerateObjectError";
  readonly code: "no_tool_call" | "parse_failed";
  override readonly cause?: unknown;
  constructor(code: "no_tool_call" | "parse_failed", message: string, cause?: unknown) {
    super(message);
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

interface GenerateObjectDeps {
  create: (options: AgentOptions) => Promise<SDKAgent>;
  /** Hard-delete the transient agent from the registry after dispose. */
  delete: (agentId: string) => Promise<void>;
}

/**
 * Implementation of `Agent.generateObject`. Receives the `Agent.create`
 * factory as a callback to keep the dependency graph acyclic (mirrors the
 * AgentBuilder pattern in D25 / agent.ts injection).
 *
 * Algorithm:
 *   1. Convert the consumer's Zod schema to JSON Schema.
 *   2. Build a single synthetic `output` CustomTool whose handler captures
 *      the raw input and short-circuits the agent loop. The handler
 *      THROWS a sentinel so the loop terminates immediately without a
 *      second LLM round-trip.
 *   3. Create ONE transient agent (per the entire generateObject call,
 *      not per retry — EC-3). Each retry re-sends through the same agent,
 *      driving fresh LLM rounds.
 *   4. On each attempt, send a wrapper prompt instructing the model to
 *      call the `output` tool. Capture the raw input via the sentinel.
 *   5. Parse the raw input via schema.parse. On success, return typed.
 *      On failure, retry until the budget is exhausted.
 *   6. Always dispose the transient agent in `finally`.
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: retry loop + capture sentinel + dispose-and-delete is a single transaction; splitting harms locality and the finally block.
export async function generateObjectImpl<T extends ZodType>(
  options: GenerateObjectOptions<T>,
  deps: GenerateObjectDeps,
): Promise<GenerateObjectResult<ZodNamespace.infer<T>>> {
  const { jsonSchema, maxRetries, initialUsage } = setupStructuredOutput(
    options.schema,
    options.maxRetries,
  );
  let capturedRaw: unknown;
  let lastUsage = initialUsage;
  const sentinel = Symbol("generate-object-sentinel");
  class CaptureSentinel extends Error {
    readonly [sentinel] = true;
    constructor(public readonly captured: unknown) {
      super("generate-object-capture");
    }
  }

  const outputTool = makeOutputTool(jsonSchema, (input) => {
    // EC-D10 (parallel tool use): first capture wins. Subsequent calls
    // in the same response are ignored.
    if (capturedRaw === undefined) {
      capturedRaw = input;
    }
    throw new CaptureSentinel(input);
  });

  const agentOptions: AgentOptions = buildTransientAgentOptions({
    model: options.model,
    local: options.local,
    outputTool,
    ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
  });
  const agent = await deps.create(agentOptions);

  try {
    const userMessage = buildToolPrompt(options.prompt);
    let lastParseError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      capturedRaw = undefined;
      const run = await agent.send(userMessage);
      const result = await run.wait();
      lastUsage = extractUsage(result);

      if (capturedRaw === undefined) {
        // Model didn't call the output tool.
        if (attempt === maxRetries) {
          throw new GenerateObjectError(
            "no_tool_call",
            "The model returned text instead of calling the `output` tool.",
          );
        }
        continue;
      }

      const parsed = options.schema.safeParse(capturedRaw);
      if (parsed.success) {
        return {
          object: parsed.data,
          raw: capturedRaw,
          usage: lastUsage,
          finishReason: "tool_use",
        };
      }
      lastParseError = parsed.error;
    }

    throw new GenerateObjectError(
      "parse_failed",
      "Schema parse failed after all retries.",
      lastParseError,
    );
  } finally {
    // EC-3: dispose AND hard-delete the transient agent so registry count
    // stays stable across retries.
    await disposeAndDeleteTransient(agent, deps.delete);
  }
}

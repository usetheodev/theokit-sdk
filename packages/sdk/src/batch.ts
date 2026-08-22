/**
 * `Agent.batch(prompts, options)` core (ADRs D134-D140).
 *
 * Fans out N prompts via bounded concurrency, isolates failures per-prompt,
 * preserves input order in the result array, supports streaming callbacks
 * + AbortSignal. The credential pool (D131) is shared across all
 * in-flight agents via `withCredentialPool` ALS scope (EC-A fix).
 *
 * @internal
 */

import { randomUUID } from "node:crypto";
import { ConfigurationError, TheokitAgentError } from "./errors.js";
import { diag } from "./internal/diagnostics.js";
import { CredentialPool, newPooledCredential } from "./internal/llm/credential-pool.js";
import { withCredentialPool } from "./internal/llm/credential-pool-context.js";
import type { CredentialPoolStrategy } from "./internal/llm/credential-pool-types.js";
import { createSemaphore } from "./internal/runtime/concurrency/async-semaphore.js";
import { get as taskRegistryGet, submit as taskRegistrySubmit } from "./internal/task/registry.js";
import type { AgentOptions, SDKAgent } from "./types/agent.js";
import type { BatchItem, BatchOptions, BatchProgress, BatchResult } from "./types/batch.js";

/** DI contract — keeps batch.ts cycle-free from agent.ts. @internal */
interface BatchDeps {
  create: (options: AgentOptions) => Promise<SDKAgent>;
}

/**
 * Pre-flight boundary validation for `Agent.batch` (arch-review Gap 3).
 *
 * Mirrors the in-repo `validateAgentOptions` / `validateCronExpression`
 * pattern: throws `ConfigurationError` with a stable code on the first
 * violation, returns silently otherwise. Pure — no I/O.
 *
 * Rules:
 * - `concurrency`, when provided, must be a positive integer (rejects
 *   0/negative/non-integer/NaN/Infinity). Previously this was caught only
 *   incidentally deep inside `createSemaphore` with a leaky "permits"
 *   message, AND after task wrapping (dangling Task on invalid input).
 * - every prompt item must carry a non-empty string prompt. Previously
 *   `normalizeItem` passed `prompt: ""` / non-string straight to
 *   `agent.send`. (Whitespace-only strings are intentionally NOT rejected —
 *   an empty string is a structural error; judging content is not this
 *   validator's job, and the repo's property tests treat any length>=1
 *   string as a valid prompt.)
 *
 * @internal
 */
export function validateBatchInput(
  prompts: ReadonlyArray<string | BatchItem>,
  options: BatchOptions,
): void {
  const { concurrency } = options;
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
    throw new ConfigurationError(
      `Agent.batch concurrency must be a positive integer, got ${concurrency}`,
      { code: "invalid_concurrency" },
    );
  }
  for (let i = 0; i < prompts.length; i++) {
    const item = prompts[i];
    const prompt = typeof item === "string" ? item : item?.prompt;
    if (typeof prompt !== "string" || prompt.length === 0) {
      throw new ConfigurationError(`Agent.batch prompt at index ${i} must be a non-empty string`, {
        code: "invalid_batch_item",
      });
    }
  }
}

/**
 * Run N prompts in parallel with bounded concurrency.
 *
 * @internal
 */
export async function batchImpl(
  prompts: ReadonlyArray<string | BatchItem>,
  options: BatchOptions,
  deps: BatchDeps,
): Promise<BatchResult[]> {
  // EC-1: empty array → no work, no agents created.
  if (prompts.length === 0) return [];

  // Pre-flight boundary validation (arch-review Gap 3). MUST run before pool
  // build AND before wrapBatchAsTask so invalid input never registers a
  // dangling Task or builds a credential pool (fail-fast, Rule 8).
  validateBatchInput(prompts, options);

  // EC-A fix: build credential pools ONCE and share via AsyncLocalStorage.
  // Without this each Agent.create() would build its own pool from identical
  // apiKeys → 4× rate-limit wastage per concurrency window.
  const sharedPools = buildPoolsFromApiKeys(
    options.providers?.apiKeys,
    options.providers?.credentialPoolStrategy,
  );
  const exec = (): Promise<BatchResult[]> => runBatch(prompts, options, deps);
  const withPool = (): Promise<BatchResult[]> =>
    sharedPools.size > 0 ? withCredentialPool(sharedPools, exec) : exec();
  // T3.3: opt-in Task wrapping (ADRs D363, D374). Register the whole
  // batch as a single Task (kind="batch") with `b-` prefix (D368/EC-5).
  if (options.task !== undefined) {
    return wrapBatchAsTask(prompts.length, options.task, withPool);
  }
  return withPool();
}

async function wrapBatchAsTask(
  total: number,
  taskOpt: true | { id?: string; meta?: Record<string, unknown> },
  exec: () => Promise<BatchResult[]>,
): Promise<BatchResult[]> {
  const opts = taskOpt === true ? {} : taskOpt;
  const id = opts.id ?? `b-${randomUUID()}`;
  const meta: Record<string, unknown> = {
    total,
    ...(opts.meta ?? {}),
  };
  let results: BatchResult[] = [];
  await taskRegistrySubmit({
    kind: "batch",
    work: async (ctx) => {
      results = await exec();
      const succeeded = results.filter((r) => r.ok).length;
      const failed = results.length - succeeded;
      ctx.emit({ total: results.length, succeeded, failed });
      return { total: results.length, succeeded, failed };
    },
    id,
    meta,
    allowReservedPrefix: true,
  });
  // submit returns immediately with a queued handle. Wait for terminal.
  for (let i = 0; i < 5000; i++) {
    const h = await taskRegistryGet(id);
    if (h?.state === "finished" || h?.state === "error" || h?.state === "cancelled") break;
    await new Promise((r) => setTimeout(r, 5));
  }
  return results;
}

async function runBatch(
  prompts: ReadonlyArray<string | BatchItem>,
  options: BatchOptions,
  deps: BatchDeps,
): Promise<BatchResult[]> {
  const requested = options.concurrency ?? 4;
  // createSemaphore throws on invalid (EC-2).
  // EC-3: cap to prompts.length to avoid idle workers.
  const effective = Math.min(requested, prompts.length);
  const semaphore = createSemaphore(effective);
  const items = prompts.map(normalizeItem);
  const results: BatchResult[] = new Array(items.length);
  const counters = { completed: 0, failed: 0 };
  let aborted = false;

  const onAbort = (): void => {
    aborted = true;
  };
  options.signal?.addEventListener("abort", onAbort);
  // EC-C: pre-aborted signal — treat as already-aborted before any work.
  if (options.signal?.aborted === true) aborted = true;

  try {
    await Promise.all(
      items.map(async (item, index) => {
        const release = await semaphore.acquire();
        try {
          if (aborted) {
            results[index] = abortResult(item, index, options.signal);
          } else {
            results[index] = await runOne(item, index, options, deps);
          }
          if (results[index].ok) counters.completed += 1;
          else counters.failed += 1;
          // B-110 (measured 2026-08-19): `onResult` used to run AFTER `release()`, so a caller who
          // asked for `concurrency: 1` still got overlapping `onResult` invocations — the permit was
          // already returned before the callback ran. `concurrency` is documented (`types/batch.ts`)
          // to bound the whole per-item lifecycle, callback included, so the permit is now held
          // until `onResult` finishes: this call moved inside the `try` the `finally` below wraps.
          await safeCallResult(options.onResult, results[index]);
        } finally {
          release();
        }
        safeCallProgress(options.onProgress, {
          total: items.length,
          completed: counters.completed,
          failed: counters.failed,
          inFlight: semaphore.inFlight(),
          pending: Math.max(0, semaphore.pending() - semaphore.inFlight()),
        });
      }),
    );
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }

  return options.filter ? results.filter(options.filter) : results;
}

async function runOne(
  item: BatchItem,
  index: number,
  options: BatchOptions,
  deps: BatchDeps,
): Promise<BatchResult> {
  const t0 = Date.now();
  const agentOpts = buildAgentOptions(item, options);

  try {
    const agent = await deps.create(agentOpts);
    try {
      const run = await agent.send(item.prompt);
      const result = await run.wait();
      return {
        ok: true,
        index,
        prompt: item.prompt,
        result,
        ...(item.metadata !== undefined ? { metadata: item.metadata } : {}),
        durationMs: Date.now() - t0,
      };
    } finally {
      // EC-8: dispose failure → stderr warn, don't fail the result.
      try {
        await agent.dispose();
      } catch (disposeErr) {
        // theokit#147 — the interceptable channel; a batch run must not write onto a TUI's frame.
        diag(
          `[theokit-sdk] batch: agent.dispose failed for prompt ${index}: ${
            disposeErr instanceof Error ? disposeErr.message : String(disposeErr)
          }\n`,
        );
      }
    }
  } catch (err) {
    return {
      ok: false,
      index,
      prompt: item.prompt,
      error: toTheokitError(err),
      ...(item.metadata !== undefined ? { metadata: item.metadata } : {}),
      durationMs: Date.now() - t0,
    };
  }
}

function buildAgentOptions(item: BatchItem, options: BatchOptions): AgentOptions {
  const {
    concurrency: _c,
    filter: _f,
    onResult: _or,
    onProgress: _op,
    signal: _s,
    task: _t,
    ...rest
  } = options;
  void _c;
  void _f;
  void _or;
  void _op;
  void _s;
  void _t;
  const agentOpts = rest as AgentOptions;
  if (item.systemPrompt !== undefined) {
    return { ...agentOpts, systemPrompt: item.systemPrompt };
  }
  return agentOpts;
}

function normalizeItem(promptOrItem: string | BatchItem): BatchItem {
  return typeof promptOrItem === "string" ? { prompt: promptOrItem } : promptOrItem;
}

function abortResult(item: BatchItem, index: number, signal?: AbortSignal): BatchResult {
  // EC-D: propagate signal.reason when set (preserves caller's error).
  let error: TheokitAgentError;
  if (signal?.reason instanceof TheokitAgentError) {
    error = signal.reason;
  } else if (signal?.reason instanceof Error) {
    error = new TheokitAgentError(signal.reason.message, {
      code: "aborted",
      cause: signal.reason,
    });
  } else {
    error = new TheokitAgentError("Batch aborted via AbortSignal", { code: "aborted" });
  }
  return {
    ok: false,
    index,
    prompt: item.prompt,
    error,
    ...(item.metadata !== undefined ? { metadata: item.metadata } : {}),
    durationMs: 0,
  };
}

function toTheokitError(err: unknown): TheokitAgentError {
  if (err instanceof TheokitAgentError) return err;
  if (err instanceof Error) {
    return new TheokitAgentError(err.message, { code: "unknown", cause: err });
  }
  return new TheokitAgentError(String(err), { code: "unknown" });
}

async function safeCallResult(cb: BatchOptions["onResult"], result: BatchResult): Promise<void> {
  if (cb === undefined) return;
  try {
    await cb(result);
  } catch (err) {
    diag(
      `[theokit-sdk] batch: onResult callback threw: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}

function safeCallProgress(cb: BatchOptions["onProgress"], progress: BatchProgress): void {
  if (cb === undefined) return;
  try {
    cb(progress);
  } catch (err) {
    diag(
      `[theokit-sdk] batch: onProgress callback threw: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}

/**
 * EC-A: construct shared pools from options.apiKeys. Empty/invalid → empty Map.
 *
 * @internal
 */
function buildPoolsFromApiKeys(
  apiKeys: Record<string, string[]> | undefined,
  strategy: Record<string, CredentialPoolStrategy> | undefined,
): Map<string, CredentialPool> {
  const pools = new Map<string, CredentialPool>();
  if (apiKeys === undefined) return pools;
  for (const [provider, keys] of Object.entries(apiKeys)) {
    if (!Array.isArray(keys)) continue;
    const filtered = keys.filter((k): k is string => typeof k === "string" && k.length > 0);
    if (filtered.length < 2) continue; // 1-key pools aren't pools
    const entries = filtered.map((token, i) =>
      newPooledCredential({ provider, accessToken: token, priority: i, source: "manual" }),
    );
    pools.set(
      provider,
      new CredentialPool(provider, entries, strategy?.[provider] ?? "fill_first"),
    );
  }
  return pools;
}

/**
 * D204 — Eval execution engine. Orchestrates dataset materialization,
 * `Agent.batch` fanout, scorer application, aggregate computation, and
 * single-flight lifecycle.
 *
 * @internal
 */

import { randomUUID } from "node:crypto";

import { Agent } from "../../agent.js";
import type { SDKAgent } from "../../types/agent.js";
import type { BatchOptions, BatchResult } from "../../types/batch.js";
import type {
  DatasetEntry,
  EvalAggregate,
  EvalHooks,
  EvalOptions,
  EvalRowResult,
  EvalRun,
  EvalRunOptions,
  NamedScorer,
  Score,
  Scorer,
} from "../../types/eval.js";
import { clampScore, computeAggregate } from "./aggregate.js";
import { materializeDataset } from "./dataset-iter.js";
import { acquireSingleFlight, releaseSingleFlight } from "./single-flight.js";
import { startEvalRunSpan } from "./telemetry.js";

/**
 * EC-4: every hook invocation is wrapped here. User code throwing in
 * `afterRow` / `beforeRun` / `afterRun` is caught + warned once to stderr;
 * the run continues.
 */
function safeHook(fn: () => undefined | undefined): void {
  try {
    fn();
  } catch (err) {
    console.warn("[eval] hook threw (ignored):", err instanceof Error ? err.message : err);
  }
}

function isAgentInstance(value: unknown): value is SDKAgent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { send?: unknown }).send === "function" &&
    typeof (value as { agentId?: unknown }).agentId === "string"
  );
}

interface NormalizedScorer {
  name: string;
  score: Scorer;
}

function normalizeScorers(input: ReadonlyArray<Scorer | NamedScorer>): NormalizedScorer[] {
  return input.map((s, i) => {
    if (typeof s === "function") {
      return { name: `scorer-${i}`, score: s };
    }
    return { name: s.name, score: s.score };
  });
}

async function applyScorer(
  scorer: NormalizedScorer,
  output: string,
  expected: unknown,
): Promise<{ name: string; score: number; reason?: string }> {
  let raw: Score;
  try {
    const result = scorer.score(output, expected);
    raw = result instanceof Promise ? await result : result;
  } catch (err) {
    return {
      name: scorer.name,
      score: 0,
      reason: `scorer_threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const clamped = clampScore(raw);
  return clamped.reason === undefined
    ? { name: scorer.name, score: clamped.score }
    : { name: scorer.name, score: clamped.score, reason: clamped.reason };
}

function rowFromBatchResult(
  entry: DatasetEntry,
  batchResult: BatchResult,
  scorerResults: ReadonlyArray<{ name: string; score: number; reason?: string }>,
  index: number,
): EvalRowResult {
  const meanScore =
    scorerResults.length === 0
      ? 0
      : scorerResults.reduce((acc, s) => acc + s.score, 0) / scorerResults.length;
  const baseFields = {
    index,
    input: entry.input,
    expected: entry.expected,
    durationMs: batchResult.durationMs ?? 0,
    scores: scorerResults,
    meanScore,
  };
  if (batchResult.ok === true) {
    return {
      ...baseFields,
      output: batchResult.result.result ?? "",
      ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
    };
  }
  return {
    ...baseFields,
    output: "",
    error: batchResult.error.message,
    ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
  };
}

/**
 * Resolve the agent factory for a given dataset entry, honoring D204's
 * three accepted shapes:
 *   - Agent instance → use as-is for every row (shared state).
 *   - AgentOptions → wrap into a per-row factory that builds + disposes.
 *   - (entry) => Agent → call to get the agent for THIS entry.
 *
 * Returns the `BatchOptions.agent`-shaped factory expected by `Agent.batch`.
 */
function makeAgentForBatch(
  spec: EvalOptions["agent"],
  _entries: ReadonlyArray<DatasetEntry>,
): BatchOptions {
  // BatchOptions extends AgentOptions; when caller provides an Agent instance,
  // we still need to pass SOMETHING to AgentOptions (model). For the instance
  // case we proxy through a degenerate options shape that we override via the
  // batch's internal agent-factory path — but the simplest correct thing is
  // to call agent.send() directly OUTSIDE batch in that case.
  if (isAgentInstance(spec) || typeof spec === "function") {
    // Both cases handled outside Agent.batch (see runEvalLoop).
    throw new Error("internal: makeAgentForBatch only handles AgentOptions");
  }
  return spec as BatchOptions;
}

/**
 * For Agent-instance OR factory-function shapes, we can't use Agent.batch
 * (which requires AgentOptions to create fresh agents). Run a hand-rolled
 * bounded loop instead.
 */
async function runRowsManually(
  entries: ReadonlyArray<DatasetEntry>,
  spec: SDKAgent | ((entry: DatasetEntry) => SDKAgent | Promise<SDKAgent>),
  scorers: ReadonlyArray<NormalizedScorer>,
  concurrency: number,
  signal: AbortSignal | undefined,
  onRow: (row: EvalRowResult, index: number) => void,
): Promise<EvalRowResult[]> {
  const rows: EvalRowResult[] = new Array(entries.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < entries.length) {
      if (signal?.aborted === true) return;
      const idx = cursor;
      cursor += 1;
      const entry = entries[idx];
      if (entry === undefined) continue;
      const t0 = Date.now();
      let output = "";
      let errorMsg: string | undefined;
      try {
        const agent = isAgentInstance(spec) ? spec : await spec(entry);
        const run = await agent.send(entry.input);
        const result = await run.wait();
        if (result.status === "finished") {
          output = result.result ?? "";
        } else {
          errorMsg = result.error?.message ?? `run ${result.status}`;
        }
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);
      }
      const durationMs = Date.now() - t0;
      const scoreEntries: Array<{ name: string; score: number; reason?: string }> = [];
      if (errorMsg === undefined) {
        for (const scorer of scorers) {
          scoreEntries.push(await applyScorer(scorer, output, entry.expected));
        }
      }
      const meanScore =
        scoreEntries.length === 0
          ? 0
          : scoreEntries.reduce((acc, s) => acc + s.score, 0) / scoreEntries.length;
      const row: EvalRowResult = {
        index: idx,
        input: entry.input,
        output,
        ...(entry.expected !== undefined ? { expected: entry.expected } : {}),
        scores: scoreEntries,
        meanScore: errorMsg === undefined ? meanScore : 0,
        durationMs,
        ...(errorMsg !== undefined ? { error: errorMsg } : {}),
        ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
      };
      rows[idx] = row;
      onRow(row, idx);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, () => worker());
  await Promise.all(workers);
  return rows.filter((r): r is EvalRowResult => r !== undefined);
}

/**
 * AgentOptions path: use Agent.batch for fanout, then apply scorers per result.
 */
async function runRowsViaBatch(
  entries: ReadonlyArray<DatasetEntry>,
  agentOptions: BatchOptions,
  scorers: ReadonlyArray<NormalizedScorer>,
  concurrency: number,
  signal: AbortSignal | undefined,
  onRow: (row: EvalRowResult, index: number) => void,
): Promise<EvalRowResult[]> {
  const prompts = entries.map((e) => e.input);
  const batchOpts: BatchOptions = {
    ...agentOptions,
    concurrency,
    ...(signal !== undefined ? { signal } : {}),
  };
  const batchResults = await Agent.batch(prompts, batchOpts);
  const rows: EvalRowResult[] = [];
  for (let i = 0; i < batchResults.length; i += 1) {
    const entry = entries[i];
    const br = batchResults[i];
    if (entry === undefined || br === undefined) continue;
    const scoreEntries: Array<{ name: string; score: number; reason?: string }> = [];
    if (br.ok === true) {
      const output = br.result.result ?? "";
      for (const scorer of scorers) {
        scoreEntries.push(await applyScorer(scorer, output, entry.expected));
      }
    }
    const row = rowFromBatchResult(entry, br, scoreEntries, i);
    rows.push(row);
    onRow(row, i);
  }
  return rows;
}

export async function runEval(
  options: EvalOptions,
  runOpts: EvalRunOptions | undefined,
): Promise<EvalRun> {
  acquireSingleFlight(options.name);
  const id = randomUUID();
  const startedAt = Date.now();
  const entries = await materializeDataset(options.dataset);
  const indexed: DatasetEntry[] = entries.map((e) => ({ ...e }));
  const scorers = normalizeScorers(options.scorers);
  const concurrency = options.concurrency ?? 4;
  const signal = runOpts?.signal;
  // D206 — open `eval.run` span (no-op when OTel unavailable). MUST end in finally.
  const span = startEvalRunSpan({
    name: options.name,
    id,
    rows: entries.length,
    concurrency,
  });
  try {
    const hooks: EvalHooks | undefined = options.hooks;
    safeHook(() => hooks?.beforeRun?.({ name: options.name, totalEstimate: entries.length }));

    const onRow = (row: EvalRowResult, i: number): void => {
      safeHook(() => hooks?.afterRow?.(row, i));
    };

    let rows: EvalRowResult[];
    if (isAgentInstance(options.agent) || typeof options.agent === "function") {
      rows = await runRowsManually(
        indexed,
        options.agent as SDKAgent | ((entry: DatasetEntry) => SDKAgent | Promise<SDKAgent>),
        scorers,
        concurrency,
        signal,
        onRow,
      );
    } else {
      const batchOpts = makeAgentForBatch(options.agent, indexed);
      rows = await runRowsViaBatch(indexed, batchOpts, scorers, concurrency, signal, onRow);
    }

    const aggregate: EvalAggregate = computeAggregate(rows);
    const endedAt = Date.now();
    const run: EvalRun = {
      id,
      name: options.name,
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      aggregate,
      rows,
      ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
    };
    safeHook(() => hooks?.afterRun?.(run));
    // Annotate the span with final aggregate metrics (D206 / D211).
    span.setAttribute("eval.aggregate.meanScore", run.aggregate.meanScore);
    span.setAttribute("eval.aggregate.errorRows", run.aggregate.errorRows);
    span.setAttribute("eval.aggregate.durationMsP95", run.aggregate.durationMsP95);
    span.setAttribute("eval.aggregate.tokensInTotal", run.aggregate.tokensInTotal);
    return run;
  } finally {
    span.end();
    releaseSingleFlight(options.name);
  }
}

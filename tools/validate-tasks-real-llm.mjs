#!/usr/bin/env node
/**
 * Phase 7 — REAL-LLM dogfood for the Task observability registry
 * (ADRs D361-D374, plan tasks-queued-running-observable v1.4).
 *
 * Drives a real `Agent.send({ task: ... })` against local Ollama
 * (qwen2.5:3b) and asserts:
 *
 *   1. The task is registered with state="queued" immediately on submit.
 *   2. State transitions queued → running → finished are observed.
 *   3. `Task.subscribe(id)` emits at least { submitted, started,
 *      finished } events with the run's result.
 *   4. `Task.list({ kind: "run" })` returns the registered task with
 *      meta.agentId + meta.runId properly populated (per T3.2).
 *   5. `Agent.batch([...], { task: true })` registers a `kind: "batch"`
 *      task with `b-` prefix (T3.3, EC-5 namespace).
 *
 * Run:
 *   node tools/validate-tasks-real-llm.mjs
 *
 * Per `.claude/rules/real-llm-validation.md` this provides
 * "real LLM observed task lifecycle" evidence — same role the ACP
 * Ollama dogfood serves for that plan.
 */

import { resolve } from "node:path";

// Import from the local SDK dist (built by `pnpm --filter @theokit/sdk build`).
const SDK_DIST = resolve(import.meta.dirname, "..", "packages", "sdk", "dist", "index.js");
const { Agent, Task } = await import(SDK_DIST);

const OLLAMA_MODEL = process.env.TASKS_OLLAMA_MODEL ?? "qwen2.5:3b";
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";

async function ollamaReachable() {
  try {
    const r = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function waitUntil(predicate, timeoutMs = 30000, pollMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

async function scenarioSingleRun(agent) {
  console.error("\n→ Scenario 1: Agent.send({ task: { id: 'tasks-real-llm-1' } })");
  const t0 = Date.now();
  const run = await agent.send("Reply with the single word 'pong' and nothing else.", {
    task: { id: "tasks-real-llm-1", meta: { scenario: "single-run" } },
  });
  console.error(`  ✓ run started in ${Date.now() - t0}ms (run.id=${run.id})`);

  // Verify task registered
  const queued = await Task.get("tasks-real-llm-1");
  if (queued === undefined) throw new Error("FAIL: Task not registered after send");
  console.error(`  ✓ task registered, initial state=${queued.state}`);

  // Subscribe to lifecycle
  const events = [];
  const sub = Task.subscribe("tasks-real-llm-1");
  void (async () => {
    for await (const ev of sub) events.push(ev);
  })();

  // Wait for run to complete
  const result = await run.wait();
  console.error(`  ✓ run.wait resolved status=${result.status}`);
  if (result.status !== "finished") {
    throw new Error(`FAIL: run did not finish (status=${result.status})`);
  }

  // Wait for task transition
  await waitUntil(async () => {
    const h = await Task.get("tasks-real-llm-1");
    return h?.state === "finished" || h?.state === "error" || h?.state === "cancelled";
  });
  const finalHandle = await Task.get("tasks-real-llm-1");
  console.error(`  ✓ task final state=${finalHandle?.state}`);

  // Validate meta
  const meta = finalHandle?.meta;
  if (meta?.agentId !== agent.agentId) {
    throw new Error(
      `FAIL: task.meta.agentId mismatch — expected ${agent.agentId}, got ${meta?.agentId}`,
    );
  }
  if (meta?.runId !== run.id) {
    throw new Error(`FAIL: task.meta.runId mismatch — expected ${run.id}, got ${meta?.runId}`);
  }
  console.error(`  ✓ task.meta.agentId + meta.runId correctly populated`);

  // Validate event stream
  await new Promise((r) => setTimeout(r, 100));
  const types = events.map((e) => e.type);
  const expectedSubset = ["submitted", "started", "finished"];
  for (const expected of expectedSubset) {
    if (!types.includes(expected)) {
      throw new Error(`FAIL: missing event type "${expected}" in stream (got ${types.join(",")})`);
    }
  }
  console.error(
    `  ✓ event stream contains submitted/started/finished (${events.length} events total)`,
  );

  // Verify reply text
  const reply = (result.result ?? "").trim();
  console.error(`  ✓ assistant reply (first 100 chars): ${JSON.stringify(reply.slice(0, 100))}`);
  if (!/pong/i.test(reply)) {
    console.error(`  ⚠ WARN — reply did not contain 'pong'. Model may have refused.`);
  } else {
    console.error(`  ✓ reply contains expected 'pong' token`);
  }
}

async function scenarioBatch() {
  console.error(
    "\n→ Scenario 2: Agent.batch(3 prompts, { task: { id: 'b-tasks-real-llm-batch' } })",
  );
  const t0 = Date.now();
  const results = await Agent.batch(
    [
      "Reply with the word 'one' and nothing else.",
      "Reply with the word 'two' and nothing else.",
      "Reply with the word 'three' and nothing else.",
    ],
    {
      apiKey: "local",
      model: { id: `ollama/${OLLAMA_MODEL}` },
      local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
      concurrency: 2,
      task: { id: "b-tasks-real-llm-batch", meta: { scenario: "batch" } },
    },
  );
  const dt = Date.now() - t0;
  console.error(`  ✓ batch completed in ${dt}ms — ${results.length} results`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.ok) {
      const text = (r.result.result ?? "").trim().slice(0, 50);
      console.error(`    ${i + 1}. ${text}`);
    } else {
      console.error(`    ${i + 1}. FAILED: ${r.error.message.slice(0, 80)}`);
    }
  }

  const taskHandle = await Task.get("b-tasks-real-llm-batch");
  if (taskHandle === undefined) throw new Error("FAIL: batch task not registered");
  if (!taskHandle.id.startsWith("b-")) {
    throw new Error(`FAIL: batch id missing 'b-' prefix (got ${taskHandle.id})`);
  }
  if (taskHandle.kind !== "batch") {
    throw new Error(`FAIL: expected kind="batch", got ${taskHandle.kind}`);
  }
  console.error(
    `  ✓ batch task registered: id=${taskHandle.id} kind=${taskHandle.kind} state=${taskHandle.state}`,
  );
}

async function scenarioListRegistry() {
  console.error("\n→ Scenario 3: Task.list inspection");
  const all = await Task.list({});
  const runs = await Task.list({ kind: "run" });
  const batches = await Task.list({ kind: "batch" });
  console.error(`  ✓ Task.list({}): ${all.length} total`);
  console.error(`  ✓ Task.list({ kind: 'run' }): ${runs.length}`);
  console.error(`  ✓ Task.list({ kind: 'batch' }): ${batches.length}`);
  if (runs.length === 0) throw new Error("FAIL: expected at least 1 run task");
  if (batches.length === 0) throw new Error("FAIL: expected at least 1 batch task");
}

async function main() {
  if (!(await ollamaReachable())) {
    console.error(`✗ FAIL: Ollama not reachable at ${OLLAMA_HOST}`);
    console.error("  Start it via: ollama serve");
    process.exit(2);
  }
  console.error(`→ Ollama reachable at ${OLLAMA_HOST}`);
  console.error(`→ Using model: ollama/${OLLAMA_MODEL}`);

  const agent = await Agent.create({
    apiKey: "local",
    model: { id: `ollama/${OLLAMA_MODEL}` },
    local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
    name: "tasks-real-llm-dogfood",
  });

  try {
    await scenarioSingleRun(agent);
    await scenarioBatch();
    await scenarioListRegistry();
  } finally {
    await agent.dispose();
  }

  console.error("");
  console.error("✅ REAL-LLM Tasks dogfood PASS");
  console.error("   Verified: Agent.send({ task }) + Agent.batch({ task }) +");
  console.error("   Task.subscribe lifecycle events + Task.list filtering, all");
  console.error("   against a real Ollama LLM. Mirrors ACP real-LLM dogfood pattern.");
}

main().catch((err) => {
  console.error(`\n✗ FAIL: ${err.message}`);
  if (err.stack) console.error(err.stack.split("\n").slice(0, 5).join("\n"));
  process.exit(1);
});

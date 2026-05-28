#!/usr/bin/env node
/**
 * Phase 6 — REAL-LLM dogfood for the Token Budget / Cost Tracker
 * (ADRs D375-D388, plan v1.2). Drives the FULL pipeline:
 *   agent.send → real tokens parsed from OpenRouter `usage` →
 *   RunResult.usage auto-populated (T4.2 lifted) →
 *   RunResult.cost auto-computed (D377) →
 *   chargeAndCheckThresholds against a real Budget → ledger reflects
 *   actual spend.
 *
 * Scenarios:
 *   1. Pricing registry + computeCost (no LLM call) — sanity.
 *   2. normalizeUsage 3 API shapes (no LLM call) — sanity.
 *   3. Budget lifecycle (no LLM call) — EC-7/EC-16/3 modes.
 *   4. REAL-LLM send via OpenRouter (`openai/gpt-4o-mini`) — verify
 *      `result.usage.totalTokens > 0`, `result.cost.amountUsd > 0`,
 *      `result.cost.status === "estimated"`, then charge a Budget +
 *      assert `Budget.spentIn("1d") === cost.amountUsd`.
 *   5. Ollama unknown-pricing route (optional, when Ollama present).
 *
 * Requires: `OPENROUTER_API_KEY` in env. Costs ~0.0001 USD per run.
 */

import "node:process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env from telegram-pro for OPENROUTER_API_KEY (real-LLM canonical).
const ENV_PATH = resolve(import.meta.dirname, "..", "examples", "telegram-pro", ".env");
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const SDK_DIST = resolve(import.meta.dirname, "..", "packages", "sdk", "dist", "index.js");
const sdk = await import(SDK_DIST);
const { Agent, Budget, chargeAndCheckThresholds, computeCost, normalizeUsage, preflightCheck } =
  sdk;

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.BUDGET_OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
const OLLAMA_MODEL = process.env.BUDGET_OLLAMA_MODEL ?? "qwen2.5:3b";
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";

async function ollamaReachable() {
  try {
    const r = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function scenarioPricing() {
  console.error("\n→ Scenario 1: Pricing registry + computeCost (no LLM call)");
  const usage = {
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 2000,
    cacheWriteTokens: 100,
    totalTokens: 3600,
  };
  const cost = computeCost({ provider: "anthropic", model: "claude-opus-4-7", usage });
  if (cost.status !== "estimated") {
    throw new Error(`FAIL: expected status="estimated", got "${cost.status}"`);
  }
  if (!(cost.amountUsd > 0)) {
    throw new Error(`FAIL: expected amountUsd > 0, got ${cost.amountUsd}`);
  }
  console.error(`  ✓ claude-opus-4-7 1k/500/2k/100 → $${cost.amountUsd.toFixed(6)} (estimated)`);

  const unknown = computeCost({
    provider: "ollama",
    model: "qwen2.5",
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  });
  if (unknown.status !== "unknown") {
    throw new Error(`FAIL: expected status="unknown" for ollama, got "${unknown.status}"`);
  }
  if (unknown.amountUsd !== undefined) {
    throw new Error(`FAIL: expected amountUsd undefined, got ${unknown.amountUsd}`);
  }
  console.error(`  ✓ ollama/qwen2.5 → status="unknown" (no pricing) — correct`);
}

async function scenarioNormalize() {
  console.error("\n→ Scenario 2: normalizeUsage 3 API shapes (no LLM call)");
  const a = normalizeUsage(
    {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 2000,
      cache_creation_input_tokens: 100,
    },
    { provider: "anthropic" },
  );
  if (a.inputTokens !== 1000 || a.cacheReadTokens !== 2000) {
    throw new Error(`FAIL: Anthropic normalize wrong: ${JSON.stringify(a)}`);
  }
  console.error(`  ✓ Anthropic 4-bucket: input=${a.inputTokens} cacheR=${a.cacheReadTokens}`);

  const o = normalizeUsage(
    {
      prompt_tokens: 3000,
      completion_tokens: 700,
      prompt_tokens_details: { cached_tokens: 1800 },
    },
    { provider: "openai" },
  );
  if (o.inputTokens !== 1200 || o.cacheReadTokens !== 1800) {
    throw new Error(`FAIL: OpenAI normalize wrong: ${JSON.stringify(o)}`);
  }
  console.error(
    `  ✓ OpenAI Chat subtract-cached: input=${o.inputTokens} cacheR=${o.cacheReadTokens}`,
  );

  const p = normalizeUsage(
    {
      prompt_tokens: 5000,
      completion_tokens: 200,
      cache_read_input_tokens: 3000,
      cache_creation_input_tokens: 1000,
    },
    { provider: "openrouter" },
  );
  if (p.cacheReadTokens !== 3000 || p.cacheWriteTokens !== 1000) {
    throw new Error(`FAIL: a peer#10266 fallback didn't kick in: ${JSON.stringify(p)}`);
  }
  console.error(
    `  ✓ a peer#10266 fallback: cacheR=${p.cacheReadTokens} cacheW=${p.cacheWriteTokens}`,
  );
}

async function scenarioBudgetLifecycle() {
  console.error("\n→ Scenario 3: Budget lifecycle (no LLM call)");
  let threwInvalid = false;
  try {
    Budget.create({ name: "", scope: "process", limits: [] });
  } catch (_e) {
    threwInvalid = true;
  }
  if (!threwInvalid) throw new Error("FAIL: empty name should throw");
  console.error(`  ✓ EC-7: empty name throws ConfigurationError`);

  Budget.create({ name: "lifecycle", scope: "process", limits: [{ window: "1d", limitUsd: 5 }] });
  let threwDup = false;
  try {
    Budget.create({ name: "lifecycle", scope: "process", limits: [] });
  } catch (_e) {
    threwDup = true;
  }
  if (!threwDup) throw new Error("FAIL: duplicate name should throw");
  console.error(`  ✓ EC-16: duplicate name throws ConfigurationError`);

  Budget.create({
    name: "audit-test",
    scope: "process",
    mode: "audit",
    limits: [{ window: "1d", limitUsd: 0.001 }],
  });
  await chargeAndCheckThresholds("audit-test", 10);
  const audit = Budget.get("audit-test");
  console.error(`  ✓ audit mode charged $10 against $0.001 limit without throwing`);
  console.error(`    spent now: $${audit.spentIn("1d")}`);

  Budget.create({
    name: "block-test",
    scope: "process",
    mode: "block",
    limits: [{ window: "1d", limitUsd: 0.001 }],
  });
  let threwBudget = false;
  try {
    preflightCheck("block-test", 1);
  } catch (e) {
    threwBudget = true;
    if (e.code !== "budget_exceeded") {
      throw new Error(`FAIL: expected code=budget_exceeded, got ${e.code}`);
    }
  }
  if (!threwBudget) throw new Error("FAIL: block mode preflight should throw BudgetExceededError");
  console.error(`  ✓ block mode preflight throws BudgetExceededError`);

  const snap = Budget.snapshot();
  console.error(`  ✓ Budget.snapshot() → ${snap.length} entries`);

  Budget.delete("lifecycle");
  Budget.delete("audit-test");
  Budget.delete("block-test");
}

function assertUsage(result) {
  if (result.usage === undefined) {
    throw new Error("FAIL: result.usage is undefined — T4.2 wire-up not working");
  }
  if (typeof result.usage.totalTokens !== "number" || result.usage.totalTokens <= 0) {
    throw new Error(`FAIL: expected totalTokens > 0, got ${result.usage.totalTokens}`);
  }
  console.error(
    `  ✓ result.usage auto-populated: input=${result.usage.inputTokens} output=${result.usage.outputTokens} total=${result.usage.totalTokens}`,
  );
}

function assertCost(result) {
  if (result.cost === undefined) {
    throw new Error("FAIL: result.cost is undefined — D377 auto-compute not working");
  }
  if (result.cost.status !== "estimated") {
    throw new Error(`FAIL: expected cost.status="estimated", got "${result.cost.status}"`);
  }
  if (typeof result.cost.amountUsd !== "number" || result.cost.amountUsd <= 0) {
    throw new Error(`FAIL: expected amountUsd > 0, got ${result.cost.amountUsd}`);
  }
  console.error(
    `  ✓ result.cost auto-computed: $${result.cost.amountUsd.toFixed(6)} (${result.cost.status})`,
  );
  console.error(`    pricingVersion=${result.cost.pricingVersion ?? "<none>"}`);
}

async function assertLedger(budgetName, amountUsd) {
  await chargeAndCheckThresholds(budgetName, amountUsd);
  const handle = Budget.get(budgetName);
  const spent1d = handle.spentIn("1d");
  if (Math.abs(spent1d - amountUsd) > 1e-6) {
    throw new Error(`FAIL: ledger drift — spent=${spent1d} vs charged=${amountUsd}`);
  }
  console.error(
    `  ✓ Budget ledger charged $${spent1d.toFixed(6)} = result.cost.amountUsd (1d window)`,
  );
  const snap = Budget.snapshot().filter((s) => s.name === budgetName);
  if (snap.length === 0) throw new Error(`FAIL: Budget.snapshot missing ${budgetName} entry`);
  console.error(`  ✓ Budget.snapshot has ${snap.length} entries for ${budgetName}`);
  for (const entry of snap) {
    console.error(
      `    window=${entry.window} spent=$${entry.spentUsd.toFixed(6)} limit=$${entry.limitUsd ?? "n/a"} ratio=${entry.ratio?.toFixed(4) ?? "n/a"}`,
    );
  }
}

async function scenarioRealLlmOpenRouter() {
  console.error("\n→ Scenario 4: REAL-LLM end-to-end via OpenRouter (full pipeline)");

  if (OPENROUTER_KEY === undefined || OPENROUTER_KEY.length === 0) {
    console.error("  ⚠ OPENROUTER_API_KEY not set — skipping real-LLM scenario");
    return { skipped: true };
  }

  // Generous audit-mode budget so the real charge lands without blocking.
  Budget.create({
    name: "openrouter-real-pipeline",
    scope: "process",
    mode: "warn",
    limits: [
      { window: "1d", limitUsd: 1 },
      { window: "30d", limitUsd: 10 },
    ],
  });

  const agent = await Agent.create({
    apiKey: OPENROUTER_KEY,
    model: { id: OPENROUTER_MODEL },
    providers: {
      routes: [{ capability: "chat", provider: "openrouter" }],
      fallback: ["openrouter"],
    },
    local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
    name: "budget-real-openrouter",
  });

  try {
    const t0 = Date.now();
    const run = await agent.send("Reply with the single word 'pong' and nothing else.");
    const result = await run.wait();
    const elapsed = Date.now() - t0;
    console.error(`  ✓ OpenRouter responded in ${elapsed}ms — status=${result.status}`);
    console.error(`    reply: ${JSON.stringify((result.result ?? "").slice(0, 100))}`);
    assertUsage(result);
    assertCost(result);
    await assertLedger("openrouter-real-pipeline", result.cost.amountUsd);

    return { skipped: false, result };
  } finally {
    await agent.dispose();
    Budget.delete("openrouter-real-pipeline");
  }
}

async function scenarioOllamaUnknownPricing() {
  console.error("\n→ Scenario 5: Ollama unknown-pricing route (optional)");
  if (!(await ollamaReachable())) {
    console.error(`  ⚠ Ollama not reachable at ${OLLAMA_HOST} — skipping`);
    return { skipped: true };
  }
  const agent = await Agent.create({
    apiKey: "local",
    model: { id: `ollama/${OLLAMA_MODEL}` },
    local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
    name: "budget-ollama-unknown",
  });
  try {
    const t0 = Date.now();
    const run = await agent.send("Reply with the single word 'pong'.");
    const result = await run.wait();
    const elapsed = Date.now() - t0;
    console.error(`  ✓ Ollama responded in ${elapsed}ms — status=${result.status}`);
    // result.usage may be present (Ollama native client populates it) or undefined.
    // Either way, cost MUST be status="unknown" because Ollama has no pricing entry.
    if (result.cost !== undefined && result.cost.status !== "unknown") {
      throw new Error(
        `FAIL: Ollama should yield cost.status="unknown", got "${result.cost.status}"`,
      );
    }
    if (result.usage !== undefined) {
      console.error(
        `  ✓ Ollama usage observed: input=${result.usage.inputTokens} output=${result.usage.outputTokens}`,
      );
    } else {
      console.error(
        `  i Ollama did not surface usage (acceptable; pricing fallback still 'unknown')`,
      );
    }
    if (result.cost !== undefined) {
      console.error(`  ✓ Ollama cost.status="${result.cost.status}" (correct: no pricing entry)`);
    }
  } finally {
    await agent.dispose();
  }
}

async function main() {
  await scenarioPricing();
  await scenarioNormalize();
  await scenarioBudgetLifecycle();
  const real = await scenarioRealLlmOpenRouter();
  await scenarioOllamaUnknownPricing();

  if (real.skipped === true) {
    console.error("\n⚠ Real-LLM scenario was SKIPPED (no OPENROUTER_API_KEY)");
    console.error("  Set OPENROUTER_API_KEY in env to run the full pipeline.");
    process.exit(2);
  }

  console.error("\n✅ REAL-LLM Budget end-to-end dogfood PASS");
  console.error("   Pipeline: agent.send → real tokens → real cost → real ledger charge");
  console.error(`   Provider: OpenRouter via ${OPENROUTER_MODEL}`);
}

main().catch((err) => {
  console.error(`\n✗ FAIL: ${err.message}`);
  if (err.stack) console.error(err.stack.split("\n").slice(0, 5).join("\n"));
  process.exit(1);
});

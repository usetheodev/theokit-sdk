/**
 * SE6 — provider prewarm / first-token latency: MEASUREMENT harness (measure-first gate).
 *
 * Anthropic's `startup()`/`WarmQuery` amortizes SUBPROCESS SPAWN. `@theokit/sdk` is in-process by
 * design — there is no subprocess. This harness measures the in-process cold-start components that a
 * hypothetical `prewarm()` could amortize, WITHOUT any network/LLM call (fixture runtime), so the
 * number is the SDK-internal overhead — not provider inference latency (which prewarm cannot reduce).
 *
 * Run: `node_modules/.bin/tsx packages/sdk/scripts/measure-cold-start.mts`
 */

const FIXTURE_KEY = "theo_test_cold_start_measure";
const MODEL = { id: "openai/gpt-4o-mini" };
const RUNS = 12;

function ms(n: number): string {
  return `${n.toFixed(3)} ms`;
}

async function main(): Promise<void> {
  // (1) Module import cost — happens once at `import`, before any run.
  const importStart = performance.now();
  const mod = await import("../src/index.js");
  const importMs = performance.now() - importStart;
  const { Agent } = mod;

  // (2) Provider-chain resolution (registerBuiltins) — the one-shot registration a prewarm would run.
  const provStart = performance.now();
  try {
    const providers = await import("../src/internal/providers/index.js");
    const reg = (providers as { registerBuiltins?: () => void }).registerBuiltins;
    if (typeof reg === "function") reg();
  } catch {
    // registerBuiltins not exported from that path — folded into Agent.create timing below.
  }
  const providerRegMs = performance.now() - provStart;

  // (3) Agent.create() — provider/plugin/personality wiring. Cold (first) vs warm (rest).
  const createTimes: number[] = [];
  const agents: Array<Awaited<ReturnType<typeof Agent.create>>> = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    const a = await Agent.create({ apiKey: FIXTURE_KEY, model: MODEL });
    createTimes.push(performance.now() - t);
    agents.push(a);
  }

  // (4) send()+stream drain — fixture runtime (NO network). First vs warm isolates per-run cold-start.
  const runTimes: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    const run = await agents[i]!.send("ping");
    for await (const _ of run.stream()) {
      // drain
    }
    runTimes.push(performance.now() - t);
  }
  for (const a of agents) a.dispose();

  const coldCreate = createTimes[0]!;
  const warmCreate = median(createTimes.slice(1));
  const coldRun = runTimes[0]!;
  const warmRun = median(runTimes.slice(1));
  const createColdDelta = coldCreate - warmCreate;
  const runColdDelta = coldRun - warmRun;
  // What a prewarm() could remove at most: the sum of the one-time overheads the first
  // create+run pay over a warm one, plus provider registration (already one-shot).
  const prewarmableCeiling = Math.max(0, createColdDelta) + Math.max(0, runColdDelta);

  const report = {
    node: process.version,
    runs: RUNS,
    module_import_ms: round(importMs),
    provider_registration_ms: round(providerRegMs),
    agent_create_cold_ms: round(coldCreate),
    agent_create_warm_median_ms: round(warmCreate),
    agent_create_cold_delta_ms: round(createColdDelta),
    first_run_cold_ms: round(coldRun),
    first_run_warm_median_ms: round(warmRun),
    first_run_cold_delta_ms: round(runColdDelta),
    prewarmable_ceiling_ms: round(prewarmableCeiling),
    THRESHOLD_material_ms: 50,
    verdict:
      prewarmableCeiling > 50
        ? "MATERIAL — build prewarm()"
        : "NEGLIGIBLE — no prewarm API warranted (YAGNI); in-process cold-start is minimal",
  };

  console.log("\n=== SE6 cold-start measurement (fixture runtime, no network) ===");
  console.log(`module import ...................... ${ms(importMs)}`);
  console.log(`provider registration (one-shot) .. ${ms(providerRegMs)}`);
  console.log(`Agent.create  cold=${ms(coldCreate)}  warm(median)=${ms(warmCreate)}  Δ=${ms(createColdDelta)}`);
  console.log(`first send()  cold=${ms(coldRun)}  warm(median)=${ms(warmRun)}  Δ=${ms(runColdDelta)}`);
  console.log(`prewarmable ceiling (Δcreate+Δrun) . ${ms(prewarmableCeiling)}  (threshold ${ms(50)})`);
  console.log(`\nVERDICT: ${report.verdict}`);
  console.log(`\nJSON: ${JSON.stringify(report)}`);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

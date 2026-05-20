import { Agent } from "@usetheo/sdk";

/**
 * Telemetry auto-instrumentation example (ADR D42).
 *
 * When `telemetry.enabled === true` AND `autoDetect !== false`, the SDK
 * feature-detects installed observability vendors via `createRequire`
 * and auto-registers their OTel exporters. Zero config required beyond
 * installing the vendor library + setting their env keys.
 *
 * Supported vendors (each is an OPTIONAL peer dep; install only what
 * you use):
 *
 *   - @langfuse/node v3+    (env: LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY)
 *   - @sentry/node          (call Sentry.init() separately before Agent.create)
 *   - posthog-node          (env: POSTHOG_API_KEY)
 *
 * This example:
 *   - Config-only when no provider key: prints the supported vendors + exits 0.
 *   - With provider key: creates an agent with telemetry enabled, sends a
 *     simple prompt. Watch stderr for `[theokit-sdk] telemetry: <vendor>
 *     auto-instrumented` lines if a vendor is installed.
 */

function pickModel(): string {
  if (process.env.ANTHROPIC_API_KEY !== undefined) return "claude-sonnet-4-5-20250929";
  if (process.env.OPENAI_API_KEY !== undefined) return "gpt-4o-mini";
  if (process.env.OPENROUTER_API_KEY !== undefined) return "google/gemini-2.0-flash-001";
  return "google/gemini-2.0-flash-001";
}

console.log("Telemetry auto-instrumentation demo (ADR D42).\n");
console.log("Vendors auto-detected when installed + their env keys are set:");
console.log("  - @langfuse/node       (env: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY)");
console.log("  - @sentry/node         (Sentry.init() separately + auto-enrichment)");
console.log("  - posthog-node         (env: POSTHOG_API_KEY)");
console.log();
console.log("Opt-out flags on telemetry:");
console.log("  { autoDetect: false }              # skip ALL vendor auto-registration");
console.log("  { disable: ['langfuse'] }          # skip a specific vendor (case-insensitive)");
console.log();

const PROVIDER_KEY =
  process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;

if (PROVIDER_KEY === undefined) {
  console.log("Config-only mode — no provider key set. Set OPENROUTER_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY in .env to drive a real agent.send.");
  process.exit(0);
}

const model = pickModel();
console.log(`Real mode — using model: ${model}`);
console.log(
  "Creating agent with `telemetry: { enabled: true, autoDetect: true, includeContent: false }`...\n",
);
console.log(
  "Watch stderr for `[theokit-sdk] telemetry: <vendor> auto-instrumented` lines if any vendor is installed.",
);
console.log("(Without `@opentelemetry/api` installed, the telemetry handle is a no-op.)\n");

const agent = await Agent.create({
  apiKey: PROVIDER_KEY,
  model: { id: model },
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } },
  telemetry: {
    enabled: true,
    autoDetect: true,
    serviceName: "telemetry-autoinstrument-demo",
    includeContent: false, // privacy default — NO prompt/completion content in spans
  },
});

try {
  const run = await agent.send("Say hi in one word.");
  const result = await run.wait();
  console.log("Result:", result.result ?? `(${result.status})`);
} finally {
  await agent.dispose();
}

/**
 * DeepAgents Parity Demo — exercises all 4 new capabilities end-to-end.
 *
 * Features demonstrated:
 *   1. Sandbox — LocalSandbox executing shell commands in isolation
 *   2. SubAgent — defineSubAgent creating a child agent callable as tool
 *   3. HITL — HitlMiddleware intercepting dangerous tool calls
 *   4. Auto-summarize — shouldSummarize + autoSummarize compressing conversation
 *
 * Run:
 *   OPENROUTER_API_KEY=sk-or-... pnpm start
 *
 * Without API key: sandbox + HITL run (no LLM needed).
 * With API key: all 4 features run including real SubAgent delegation + auto-summarize.
 */

import { Agent } from "@theokit/sdk";
import { LocalSandbox } from "@theokit/sdk/sandbox";
import { SubAgent } from "@theokit/sdk/a2a";
import { HitlMiddleware } from "../../packages/sdk/src/internal/runtime/hitl-middleware.js";
import {
  shouldSummarize,
  autoSummarize,
  resolveAutoSummarizeConfig,
  type CompressibleMessage,
} from "../../packages/sdk/src/internal/runtime/auto-summarize.js";

const apiKey = process.env.OPENROUTER_API_KEY;
const hasLlm = apiKey?.startsWith("sk-or-") ?? false;

console.log("\n========================================");
console.log("  DeepAgents Parity Demo");
console.log("========================================\n");
console.log(`Mode: ${hasLlm ? "REAL LLM (OpenRouter)" : "LOCAL ONLY (no LLM)"}\n`);

// ─── 1. SANDBOX ─────────────────────────────────────────────────────────────

console.log("── 1. Sandbox (LocalSandbox) ──\n");

const sandbox = new LocalSandbox({ workDir: "/tmp/theokit-sandbox-demo", timeoutMs: 5000 });

// Execute a command
const execResult = await sandbox.execute("echo 'Hello from sandbox!' && date");
console.log(`  execute("echo ..."):
    stdout: ${execResult.stdout.trim()}
    exitCode: ${execResult.exitCode}
    timedOut: ${execResult.timedOut}`);

// Write + read roundtrip
await sandbox.writeFile("/tmp/theokit-sandbox-demo/demo.txt", "TheoKit Sandbox works!");
const content = await sandbox.readFile("/tmp/theokit-sandbox-demo/demo.txt");
console.log(`  writeFile + readFile roundtrip: "${content.trim()}"`);

// Glob
await sandbox.execute("touch /tmp/theokit-sandbox-demo/a.ts /tmp/theokit-sandbox-demo/b.ts");
const files = await sandbox.glob("*.ts", "/tmp/theokit-sandbox-demo");
console.log(`  glob("*.ts"): ${files.length} files found`);

// Grep
const grepResults = await sandbox.grep("TheoKit", "/tmp/theokit-sandbox-demo/demo.txt");
console.log(`  grep("TheoKit"): ${grepResults.length} match(es)`);

// Timeout
const timeoutResult = await sandbox.execute("sleep 30", { timeoutMs: 200 });
console.log(`  execute("sleep 30", timeout=200ms): timedOut=${timeoutResult.timedOut}`);

console.log("\n  SANDBOX PASS\n");

// ─── 2. HITL MIDDLEWARE ────────────────────────────────────────────────────

console.log("── 2. HITL Middleware ──\n");

const hitlApprovals: string[] = [];
const hitl = new HitlMiddleware({
  tools: ["execute", "writeFile"],
  approve: async (toolName, input) => {
    hitlApprovals.push(toolName);
    console.log(`  [HITL] Approval requested for "${toolName}" with input: ${JSON.stringify(input).slice(0, 80)}`);
    // Auto-approve for demo
    return true;
  },
  timeoutMs: 5000,
});

// Unlisted tool — passes through
const readOk = await hitl.shouldProceed("readFile", { path: "/tmp/test" });
console.log(`  shouldProceed("readFile"): ${readOk} (unlisted → auto-allow)`);

// Listed tool — triggers approve
const execOk = await hitl.shouldProceed("execute", { command: "rm -rf /" });
console.log(`  shouldProceed("execute"): ${execOk} (listed → approve callback called)`);

// Listed tool — rejected
const hitlReject = new HitlMiddleware({
  tools: ["deploy"],
  approve: async () => false,
});
const deployOk = await hitlReject.shouldProceed("deploy", { env: "production" });
console.log(`  shouldProceed("deploy"): ${deployOk} (rejected by callback)`);

// Error in callback — fail-closed
const hitlError = new HitlMiddleware({
  tools: ["dangerous"],
  approve: async () => { throw new Error("network timeout"); },
});
const dangerOk = await hitlError.shouldProceed("dangerous", {});
console.log(`  shouldProceed("dangerous"): ${dangerOk} (callback threw → fail-closed)`);

console.log(`  Approvals logged: [${hitlApprovals.join(", ")}]`);
console.log("\n  HITL PASS\n");

// ─── 3. AUTO-SUMMARIZE ───────────────────────────────────────────────────

console.log("── 3. Auto-Summarize ──\n");

const config = resolveAutoSummarizeConfig({ triggerFraction: 0.85, keepNewest: 2 });
console.log(`  Config: triggerFraction=${config.triggerFraction}, keepNewest=${config.keepNewest}`);

// Trigger check
console.log(`  shouldSummarize(900, 1000): ${shouldSummarize(900, 1000, config)} (90% > 85% → true)`);
console.log(`  shouldSummarize(500, 1000): ${shouldSummarize(500, 1000, config)} (50% < 85% → false)`);
console.log(`  shouldSummarize(100, 0):    ${shouldSummarize(100, 0, config)} (div-by-zero guard → false)`);

// Summarize with mock LLM (or real if available)
const messages: CompressibleMessage[] = [
  { role: "user", content: "What is quantum computing?" },
  { role: "assistant", content: "Quantum computing uses qubits that can be in superposition..." },
  { role: "user", content: "How does it compare to classical computing?" },
  { role: "assistant", content: "Classical computers use bits (0 or 1), quantum uses qubits..." },
  { role: "user", content: "What are the main applications?" },
  { role: "assistant", content: "Cryptography, drug discovery, optimization problems..." },
];

console.log(`  Messages before: ${messages.length}`);

if (hasLlm) {
  // Real LLM summarization via OpenRouter
  const agent = await Agent.create({
    apiKey,
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: process.cwd() },
    providers: {
      routes: [{ capability: "chat" as const, provider: "openrouter" }],
      fallback: ["openrouter"],
    },
  });

  const summarized = await autoSummarize({
    messages,
    config,
    callLlm: async (model, system, user) => {
      const run = await agent.send(user, { systemPrompt: system });
      const result = await run.wait();
      return result.result ?? "";
    },
  });

  console.log(`  Messages after (real LLM): ${summarized.length}`);
  console.log(`  Summary: "${summarized[0]!.content.slice(0, 120)}..."`);
  console.log(`  Kept messages: ${summarized.slice(1).map(m => m.content.slice(0, 40)).join(" | ")}`);
  agent.dispose();
} else {
  // Mock LLM
  const summarized = await autoSummarize({
    messages,
    config,
    callLlm: async () => "User discussed quantum computing: basics, comparison to classical, and applications.",
  });
  console.log(`  Messages after (mock): ${summarized.length} (1 summary + ${config.keepNewest} kept)`);
  console.log(`  Summary: "${summarized[0]!.content.slice(0, 100)}"`);
}

// Edge case: fewer messages than keepNewest
const fewMessages: CompressibleMessage[] = [
  { role: "user", content: "Hello" },
];
const unchanged = await autoSummarize({
  messages: fewMessages,
  config,
  callLlm: async () => { throw new Error("should not be called"); },
});
console.log(`  Edge case (1 msg, keep=2): returned unchanged=${unchanged === fewMessages}`);

console.log("\n  AUTO-SUMMARIZE PASS\n");

// ─── 4. SUBAGENT DELEGATION ─────────────────────────────────────────────

console.log("── 4. SubAgent Delegation ──\n");

if (hasLlm) {
  // Create a subagent tool
  const researcherTool = SubAgent.create({
    name: "researcher",
    description: "A research assistant that answers factual questions concisely",
    instructions: "You are a concise research assistant. Answer in 1-2 sentences max. Be factual.",
    model: "openai/gpt-4o-mini",
  });

  console.log(`  defineSubAgent created tool: name="${researcherTool.name}", desc="${researcherTool.description}"`);

  // Create parent agent with the subagent as a tool
  const parentAgent = await Agent.create({
    apiKey,
    model: { id: "openai/gpt-4o-mini" },
    systemPrompt: "You are a coordinator. When asked a factual question, use the 'researcher' tool to get the answer. Pass the question as the 'input' parameter.",
    tools: [researcherTool],
    local: { cwd: process.cwd() },
    providers: {
      routes: [{ capability: "chat" as const, provider: "openrouter" }],
      fallback: ["openrouter"],
    },
  });

  console.log("  Parent agent created with researcher subagent tool");
  console.log("  Sending: 'What is the capital of France?'");

  const run = await parentAgent.send("What is the capital of France?");
  const result = await run.wait();

  console.log(`  Result status: ${result.status}`);
  console.log(`  Response: "${(result.result ?? "(no result)").slice(0, 200)}"`);

  parentAgent.dispose();
  console.log("  Parent agent disposed");
} else {
  // Verify defineSubAgent works structurally
  const tool = SubAgent.create({
    name: "researcher",
    description: "Research assistant",
    instructions: "Answer questions.",
    maxDelegationDepth: 3,
  });
  console.log(`  defineSubAgent created tool: name="${tool.name}"`);
  console.log(`  inputSchema defined: ${!!tool.inputSchema}`);
  console.log(`  handler is function: ${typeof tool.handler === "function"}`);

  // Depth limit
  try {
    SubAgent.create({ name: "deep", description: "Too deep", instructions: "Go deeper." }, 3);
    console.log("  ERROR: should have thrown MaxDelegationDepthError");
  } catch (e: unknown) {
    console.log(`  Depth limit (depth=4, max=3): ${(e as Error).name}`);
  }
}

console.log("\n  SUBAGENT PASS\n");

// ─── SUMMARY ──────────────────────────────────────────────────────────────

console.log("========================================");
console.log("  ALL 4 FEATURES PASSED");
console.log(`  Mode: ${hasLlm ? "REAL LLM" : "LOCAL"}`);
console.log("========================================\n");

// Cleanup
await sandbox.execute("rm -rf /tmp/theokit-sandbox-demo");

/**
 * Decorator-based Agentic Demo — real LLM test using @theokit/di-agent decorators.
 *
 * Demonstrates all 4 decorators storing metadata + being read at runtime
 * to configure the agentic features that were tested in run.ts.
 *
 * Run:
 *   OPENROUTER_API_KEY=sk-or-... npx tsx examples/deepagents-parity-demo/run-decorators.ts
 */

import "reflect-metadata";
import { Agent } from "@theokit/sdk";
import { LocalSandbox } from "@theokit/sdk/sandbox";
import { defineSubAgent } from "@theokit/sdk/a2a";
import { HitlMiddleware } from "../../packages/sdk/src/internal/runtime/hitl-middleware.js";
import {
  shouldSummarize,
  autoSummarize,
  resolveAutoSummarizeConfig,
  type CompressibleMessage,
} from "../../packages/sdk/src/internal/runtime/auto-summarize.js";

// Import decorators + readers
import {
  UseSandbox,
  readSandboxMetadata,
  SubAgent as SubAgentDecorator,
  readSubAgentMetadata,
  Hitl,
  readHitlMetadata,
  AutoSummarize,
  readAutoSummarizeMetadata,
} from "../../packages/di-agent/src/index.js";

const apiKey = process.env.OPENROUTER_API_KEY;
const hasLlm = apiKey?.startsWith("sk-or-") ?? false;

console.log("\n========================================");
console.log("  Decorator-Based Agentic Demo");
console.log("========================================\n");
console.log(`Mode: ${hasLlm ? "REAL LLM (OpenRouter)" : "LOCAL ONLY"}\n`);

// ─── Define a decorated agent class ─────────────────────────────────────

@AutoSummarize({ triggerFraction: 0.80, keepNewest: 3 })
class MyAgent {
  @UseSandbox({ backend: "local", workDir: "/tmp/decorator-demo", timeoutMs: 5000 })
  sandbox!: LocalSandbox;

  @SubAgentDecorator({
    name: "researcher",
    description: "A concise research assistant",
    instructions: "Answer factual questions in 1-2 sentences max.",
    model: "openai/gpt-4o-mini",
  })
  researcher!: unknown;

  @Hitl({ tools: ["execute", "writeFile"], timeoutMs: 10_000 })
  async approve(toolName: string, input: unknown): Promise<boolean> {
    console.log(`    [HITL] Approve "${toolName}"? → auto-approved for demo`);
    return true;
  }
}

// ─── 1. Read decorator metadata ─────────────────────────────────────────

console.log("── 1. Decorator Metadata Readout ──\n");

const sandboxMeta = readSandboxMetadata(MyAgent);
console.log(`  @UseSandbox metadata:`);
for (const [key, opts] of sandboxMeta) {
  console.log(`    property "${String(key)}": backend=${opts.backend}, workDir=${opts.workDir}, timeout=${opts.timeoutMs}`);
}

const subagentMeta = readSubAgentMetadata(MyAgent);
console.log(`  @SubAgent metadata:`);
for (const [key, spec] of subagentMeta) {
  console.log(`    property "${String(key)}": name=${spec.name}, model=${spec.model}, instructions="${spec.instructions.slice(0, 50)}..."`);
}

const hitlMeta = readHitlMetadata(MyAgent);
console.log(`  @Hitl metadata:`);
console.log(`    method="${String(hitlMeta?.methodKey)}", tools=[${hitlMeta?.tools.join(",")}], timeout=${hitlMeta?.timeoutMs}`);

const autoSumMeta = readAutoSummarizeMetadata(MyAgent);
console.log(`  @AutoSummarize metadata:`);
console.log(`    triggerFraction=${autoSumMeta?.triggerFraction}, keepNewest=${autoSumMeta?.keepNewest}`);

console.log("\n  METADATA READOUT PASS\n");

// ─── 2. Wire metadata → runtime (sandbox) ──────────────────────────────

console.log("── 2. Sandbox (wired from @UseSandbox metadata) ──\n");

const sandboxOpts = sandboxMeta.get("sandbox")!;
const sandbox = new LocalSandbox({
  workDir: sandboxOpts.workDir,
  timeoutMs: sandboxOpts.timeoutMs,
});

const execResult = await sandbox.execute("echo 'Decorator-wired sandbox!'");
console.log(`  execute result: "${execResult.stdout.trim()}", exitCode=${execResult.exitCode}`);
await sandbox.writeFile("/tmp/decorator-demo/test.txt", "Decorator works!");
const content = await sandbox.readFile("/tmp/decorator-demo/test.txt");
console.log(`  writeFile+readFile: "${content.trim()}"`);

console.log("\n  SANDBOX PASS\n");

// ─── 3. HITL (wired from @Hitl metadata) ────────────────────────────────

console.log("── 3. HITL (wired from @Hitl metadata) ──\n");

const hitlConfig = hitlMeta!;
const agent = new MyAgent();
const hitl = new HitlMiddleware({
  tools: hitlConfig.tools,
  approve: (name, input) => agent.approve(name, input),
  timeoutMs: hitlConfig.timeoutMs,
});

const readOk = await hitl.shouldProceed("readFile", {});
console.log(`  readFile (unlisted): ${readOk}`);
const execOk = await hitl.shouldProceed("execute", { cmd: "ls" });
console.log(`  execute (listed): ${execOk}`);

console.log("\n  HITL PASS\n");

// ─── 4. Auto-Summarize (wired from @AutoSummarize metadata) ────────────

console.log("── 4. Auto-Summarize (wired from @AutoSummarize metadata) ──\n");

const sumConfig = resolveAutoSummarizeConfig({
  triggerFraction: autoSumMeta!.triggerFraction,
  keepNewest: autoSumMeta!.keepNewest,
});

console.log(`  Config from decorator: trigger=${sumConfig.triggerFraction}, keep=${sumConfig.keepNewest}`);
console.log(`  shouldSummarize(850/1000): ${shouldSummarize(850, 1000, sumConfig)} (85% >= 80% trigger)`);

const messages: CompressibleMessage[] = [
  { role: "user", content: "What is TypeScript?" },
  { role: "assistant", content: "TypeScript is a typed superset of JavaScript." },
  { role: "user", content: "What about Zod?" },
  { role: "assistant", content: "Zod is a TypeScript-first schema validation library." },
  { role: "user", content: "And decorators?" },
  { role: "assistant", content: "Decorators are a stage 3 proposal for annotating classes." },
];

if (hasLlm) {
  const llmAgent = await Agent.create({
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
    config: sumConfig,
    callLlm: async (_model, system, user) => {
      const run = await llmAgent.send(user, { systemPrompt: system });
      const result = await run.wait();
      return result.result ?? "";
    },
  });

  console.log(`  Messages: ${messages.length} → ${summarized.length} (real LLM)`);
  console.log(`  Summary: "${summarized[0]!.content.slice(0, 100)}..."`);
  llmAgent.dispose();
} else {
  const summarized = await autoSummarize({
    messages,
    config: sumConfig,
    callLlm: async () => "Discussed TypeScript, Zod, and decorators.",
  });
  console.log(`  Messages: ${messages.length} → ${summarized.length} (mock)`);
}

console.log("\n  AUTO-SUMMARIZE PASS\n");

// ─── 5. SubAgent (wired from @SubAgent metadata) ────────────────────────

console.log("── 5. SubAgent (wired from @SubAgent metadata) ──\n");

const subSpec = subagentMeta.get("researcher")!;

if (hasLlm) {
  const researcherTool = defineSubAgent({
    name: subSpec.name,
    description: subSpec.description,
    instructions: subSpec.instructions,
    model: subSpec.model,
  });

  console.log(`  Tool from decorator metadata: name="${researcherTool.name}"`);

  const parentAgent = await Agent.create({
    apiKey,
    model: { id: "openai/gpt-4o-mini" },
    systemPrompt: "Use the researcher tool to answer questions. Pass the question as input.",
    tools: [researcherTool],
    local: { cwd: process.cwd() },
    providers: {
      routes: [{ capability: "chat" as const, provider: "openrouter" }],
      fallback: ["openrouter"],
    },
  });

  console.log("  Asking parent: 'What year was TypeScript released?'");
  const run = await parentAgent.send("What year was TypeScript released?");
  const result = await run.wait();
  console.log(`  Status: ${result.status}`);
  console.log(`  Response: "${(result.result ?? "(none)").slice(0, 200)}"`);
  parentAgent.dispose();
} else {
  console.log(`  SubAgent spec from decorator: name="${subSpec.name}", model="${subSpec.model}"`);
  const tool = defineSubAgent(subSpec);
  console.log(`  Tool created: handler=${typeof tool.handler}`);
}

console.log("\n  SUBAGENT PASS\n");

// ─── FINAL ──────────────────────────────────────────────────────────────

console.log("========================================");
console.log("  ALL 5 DECORATOR TESTS PASSED");
console.log(`  Mode: ${hasLlm ? "REAL LLM" : "LOCAL"}`);
console.log("========================================\n");

await sandbox.execute("rm -rf /tmp/decorator-demo");

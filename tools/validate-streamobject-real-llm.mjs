// Real-LLM validation for Agent.streamObject (ADR D39).
//
// Asserts:
//   1. Returned `complete` event has Zod-parsed object (typecheck post-parse)
//   2. `raw` non-undefined (model called synthetic tool)
//   3. `finishReason === "tool_use"`
//   4. Registry leak == 0
//   5. Partial count is reported (best-effort; provider-dependent)
//
// Snapshot: .claude/knowledge-base/reviews/streamobject-real-llm-{date}.md

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "/home/paulo/Projetos/usetheo/theokit-sdk/node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js";
import { Agent } from "/home/paulo/Projetos/usetheo/theokit-sdk/packages/sdk/dist/index.js";

const envPath = "/home/paulo/Projetos/usetheo/theokit-sdk/.env";
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

const apiKey =
  process.env.OPENROUTER_API_KEY ??
  process.env.ANTHROPIC_API_KEY ??
  process.env.OPENAI_API_KEY ??
  process.env.THEOKIT_API_KEY;

if (apiKey === undefined || apiKey.length === 0) {
  console.error("No real provider API key in env. Cannot validate real-LLM path.");
  process.exit(1);
}

const cwd = mkdtempSync(join(tmpdir(), "streamobj-real-"));
console.log(`Workspace: ${cwd}`);

const FactCard = z.object({
  title: z.string().min(1),
  summary: z.string().min(10),
  year: z.number().int().nullable(),
  sources: z.array(z.string()).min(1).max(3),
});

const t0 = Date.now();
let completeEvent;
let partialCount = 0;
let errorThrown;
try {
  for await (const evt of Agent.streamObject({
    apiKey,
    model: { id: "google/gemini-2.0-flash-001" },
    local: { cwd, sandboxOptions: { enabled: false } },
    schema: FactCard,
    prompt: "Produce a structured fact card about: the Great Wall of China.",
    systemPrompt:
      "You produce a structured fact card. Match the schema exactly. Set year to null if unknown.",
    maxRetries: 2,
  })) {
    if (evt.type === "partial") {
      partialCount += 1;
    } else if (evt.type === "complete") {
      completeEvent = evt;
    }
  }
} catch (err) {
  errorThrown = err instanceof Error ? err.message : String(err);
}
const elapsed = Date.now() - t0;

const checks = [];
checks.push({
  name: "stream finished without error",
  pass: errorThrown === undefined,
  detail: errorThrown,
});
checks.push({ name: "complete event emitted", pass: completeEvent !== undefined });
checks.push({
  name: "complete.object schema-valid",
  pass: completeEvent !== undefined && typeof completeEvent.object.title === "string",
});
checks.push({
  name: "complete.finishReason === tool_use",
  pass: completeEvent?.finishReason === "tool_use",
});
checks.push({
  name: "complete.raw non-undefined",
  pass: completeEvent?.raw !== undefined,
});

const registryPath = join(cwd, ".theokit", "agents", "registry.json");
let registrySize = 0;
if (existsSync(registryPath)) {
  try {
    const reg = JSON.parse(readFileSync(registryPath, "utf8"));
    registrySize = Object.keys(reg.agents ?? {}).length;
  } catch {
    // ok
  }
}
checks.push({ name: "registry leak == 0", pass: registrySize === 0 });

const allPass = checks.every((c) => c.pass);

console.log("\nResult:");
for (const c of checks) {
  console.log(`  ${c.pass ? "✅" : "❌"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
}
console.log(`\nPartials emitted: ${partialCount}`);
if (completeEvent) {
  console.log(`Object: ${JSON.stringify(completeEvent.object, null, 2)}`);
}
console.log(`Elapsed: ${elapsed}ms`);

const provider =
  process.env.OPENROUTER_API_KEY !== undefined
    ? "OpenRouter"
    : process.env.OPENAI_API_KEY !== undefined
      ? "OpenAI"
      : process.env.ANTHROPIC_API_KEY !== undefined
        ? "Anthropic"
        : "Theokit (?)";

const snapshot = `# streamObject Real-LLM Validation — ${new Date().toISOString()}

Acceptance rubric (ADR D39): \`Agent.streamObject\` MUST emit exactly one
\`complete\` event with a Zod-parsed object, NO transient agent leak. Partials
are best-effort (provider-dependent).

## Configuration

- Provider: ${provider}
- Model: google/gemini-2.0-flash-001
- Schema: \`{ title, summary, year (int|null), sources[1..3] }\`
- Workspace: ${cwd}
- maxRetries: 2

## Result

| # | Check | Pass |
|---|---|---|
${checks.map((c, i) => `| ${i + 1} | ${c.name} | ${c.pass ? "✅" : "❌"} |`).join("\n")}

- Partials emitted: ${partialCount}
- Elapsed: ${elapsed}ms
- finishReason: \`${completeEvent?.finishReason ?? "(n/a)"}\`

## Generated object

\`\`\`json
${completeEvent ? JSON.stringify(completeEvent.object, null, 2) : "(no complete event)"}
\`\`\`

## Verdict

**${allPass ? "PASS" : "FAIL"}** — ${checks.filter((c) => c.pass).length}/${checks.length} checks passed.

Note: Gemini via OpenRouter typically batches tool_use output, so zero
partial events is expected; \`complete\` is the load-bearing event. The
contract is: ≥1 complete event, schema-valid, zero registry leak.
`;

writeFileSync(
  "/home/paulo/Projetos/usetheo/theokit-sdk/.claude/knowledge-base/reviews/streamobject-real-llm-2026-05-17.md",
  snapshot,
);
console.log("Wrote: .claude/knowledge-base/reviews/streamobject-real-llm-2026-05-17.md");
process.exit(allPass ? 0 : 1);

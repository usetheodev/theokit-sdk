// Memory at scale audit (ADR D35).
//
// Ingests N synthetic facts across distinct semantic themes, runs
// Memory.runDreamingSweep, and asserts clustersCreated >= target.
//
// Active Memory recall is measured by sending follow-up queries and
// inspecting the `<active-memory>` block surfaced via run events.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, Memory } from "/home/paulo/Projetos/usetheo/theokit-sdk/packages/sdk/dist/index.js";

const cwd = mkdtempSync(join(tmpdir(), "memory-audit-"));
console.log(`Workspace: ${cwd}`);

const facts = [
  // Theme 1: Editor preferences (3 facts)
  "Remember: I prefer Helix as my code editor.",
  "Remember: My favorite color scheme is solarized dark.",
  "Remember: I use vim keybindings everywhere.",
  // Theme 2: Programming languages (3 facts)
  "Remember: My favorite programming language is Rust.",
  "Remember: I write Python for data scripts.",
  "Remember: TypeScript is my preferred language for frontend.",
  // Theme 3: Tools (3 facts)
  "Remember: My favorite test runner is Vitest.",
  "Remember: I use pnpm as the package manager.",
  "Remember: I deploy with Fly.io.",
  // Theme 4: Personal (3 facts)
  "Remember: I live in São Paulo, Brazil.",
  "Remember: I drink coffee in the morning.",
  "Remember: I prefer working remotely.",
];

const apiKey =
  process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("No provider key in env (OPENROUTER_API_KEY/ANTHROPIC_API_KEY/OPENAI_API_KEY)");
  process.exit(2);
}

const agent = await Agent.create({
  agentId: `memory-audit-${Date.now()}`,
  apiKey: process.env.THEOKIT_API_KEY ?? "user-real-example-key",
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd },
  memory: {
    enabled: true,
    namespace: "audit",
    scope: "user",
    userId: "audit-user",
    activeRecall: { enabled: true, queryMode: "recent" },
    index: {
      tools: true,
      embedding: { provider: "openrouter", model: "openai/text-embedding-3-small" },
    },
  },
  systemPrompt:
    "You are a memory ingestion bot. For each `Remember:` prompt, acknowledge briefly. Do not embellish.",
});

console.log(`\nIngesting ${facts.length} facts...`);
for (const fact of facts) {
  const run = await agent.send(fact);
  await run.wait();
}

console.log("\nRunning dreaming sweep...");
const sweepResult = await Memory.runDreamingSweep({
  cwd,
  namespace: "audit",
  scope: "user",
  userId: "audit-user",
  embedding: { provider: "openrouter", model: "openai/text-embedding-3-small" },
});
console.log("Dreaming sweep result:", sweepResult);

// Validate cluster count
const clusterTarget = 4; // We seeded 4 distinct themes
const clustersOk = sweepResult.clustersCreated >= clusterTarget;
console.log(
  `\nCluster target: >=${clusterTarget}; produced: ${sweepResult.clustersCreated} ${clustersOk ? "✅" : "❌"}`,
);

// Recall test: ask 4 thematic questions
const queries = [
  { topic: "editor", q: "What's my favorite code editor?", expect: /helix/i },
  { topic: "language", q: "Which language do I prefer?", expect: /rust/i },
  { topic: "test runner", q: "What test runner do I use?", expect: /vitest/i },
  { topic: "city", q: "Where do I live?", expect: /são paulo|sao paulo|brazil/i },
];
let recallHits = 0;
console.log("\nRecall test:");
for (const q of queries) {
  const run = await agent.send(q.q);
  const result = await run.wait();
  const reply = result.result ?? "";
  const hit = q.expect.test(reply);
  recallHits += hit ? 1 : 0;
  console.log(`  [${q.topic}] q="${q.q}" hit=${hit ? "✅" : "❌"} reply="${reply.slice(0, 100)}"`);
}
const recallRate = (recallHits / queries.length) * 100;
console.log(`\nRecall hit rate: ${recallHits}/${queries.length} = ${recallRate.toFixed(0)}%`);

await agent.dispose();

const passed = clustersOk && recallRate >= 75;
console.log(
  `\n${passed ? "PASS" : "FAIL"} — clusters: ${sweepResult.clustersCreated}/${clusterTarget}, recall: ${recallRate}%`,
);

// Write snapshot
const { writeFileSync } = await import("node:fs");
const snapshot = `# Memory Scale Audit — ${new Date().toISOString()}

Acceptance rubric (ADR D35):
- Ingest N facts across distinct themes → \`clustersCreated >= target\`
- Active Memory recall hit rate >= 75% across thematic queries

## Configuration

- Facts ingested: ${facts.length}
- Themes: 4 (editor, programming language, tools, personal)
- Embedding provider: openrouter / openai/text-embedding-3-small
- Cluster target: ${clusterTarget}
- Recall queries: ${queries.length}

## Results

- Clusters created: **${sweepResult.clustersCreated}** ${clustersOk ? "✅ ≥4" : "❌ <4"}
- Facts before/after: ${sweepResult.factsBefore} → ${sweepResult.factsAfter}
- Duplicates removed: ${sweepResult.duplicatesRemoved}
- Notes written: ${sweepResult.notesWritten}
- Recall hit rate: **${recallHits}/${queries.length} = ${recallRate.toFixed(0)}%** ${recallRate >= 75 ? "✅" : "❌"}

## Per-query recall

${queries.map((q) => `- [${q.topic}] q="${q.q}" pattern=\`${q.expect}\``).join("\n")}

## Verdict

**${passed ? "PASS" : "FAIL"}** — clusters: ${sweepResult.clustersCreated}/${clusterTarget}, recall: ${recallRate}%
`;
writeFileSync(
  "/home/paulo/Projetos/usetheo/theokit-sdk/.claude/knowledge-base/reviews/memory-scale-2026-05-17.md",
  snapshot,
);
console.log("Wrote: .claude/knowledge-base/reviews/memory-scale-2026-05-17.md");
process.exit(passed ? 0 : 1);

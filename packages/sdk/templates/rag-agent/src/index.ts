/**
 * TheoKit RAG Agent — retrieval-augmented generation pipeline.
 *
 * Demonstrates Memory.openIndex for indexing local documents,
 * searching for relevant context, and feeding results into an
 * agent via a custom tool.
 */

import { Agent, defineTool, Memory } from "@theokit/sdk";
import { z } from "zod";

// 1. Open (or create) a memory index over local files.
const index = await Memory.openIndex({
  cwd: process.cwd(),
  sources: ["memory", "wiki"],
});

// 2. Sync the index — scans .theokit/memory/ for new or changed files.
const syncResult = await index.sync();
console.log(
  `Index synced: ${syncResult.filesScanned} files scanned, ` +
    `${syncResult.chunksWritten} chunks written.`,
);

// 3. Define a retrieval tool the agent can call.
const retrieveTool = defineTool({
  name: "search_knowledge",
  description:
    "Search the local knowledge base for information relevant to a query. " +
    "Returns the top matching text snippets with citations.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    maxResults: z.number().optional().default(5),
  }),
  handler: async ({ query, maxResults }) => {
    const results = await index.search(query, { maxResults });
    if (results.length === 0) return "No relevant documents found.";

    return results
      .map((r, i) => `[${i + 1}] (score: ${r.score.toFixed(2)}) ${r.citation}\n${r.snippet}`)
      .join("\n\n");
  },
});

// 4. Create an agent equipped with the retrieval tool.
const agent = await Agent.create({
  agentId: "rag-demo",
  apiKey: process.env.THEOKIT_API_KEY ?? "local",
  model: { id: process.env.AGENT_MODEL ?? "anthropic/claude-3-5-sonnet-latest" },
  systemPrompt:
    "You are a knowledge assistant. When the user asks a question, use the " +
    "search_knowledge tool to find relevant context before answering. " +
    "Always cite sources.",
  tools: [retrieveTool],
  local: { cwd: process.cwd() },
});

// 5. Ask a question.
const question = process.argv[2] ?? "What topics are covered in the knowledge base?";
console.log(`\nQuestion: ${question}\n`);

const run = await agent.send(question);
for await (const event of run.stream()) {
  if (event.type === "assistant") {
    for (const part of event.message.content) {
      if (part.type === "text") process.stdout.write(part.text);
    }
  }
}
await run.wait();

console.log("\n");
index.close();
agent.dispose();

/**
 * {{projectName}} — retrieval-augmented generation over your own files.
 *
 * Indexes `.theokit/memory/`, exposes the index to the model as a tool, and
 * lets the model decide when to search. The agent answers from retrieved
 * snippets and cites them.
 */

import { Agent, Memory, type Run, Tool } from "@theokit/sdk";
import { z } from "zod";

const API_KEY = process.env.THEOKIT_API_KEY ?? "local";
const MODEL = process.env.AGENT_MODEL ?? "anthropic/claude-3-5-sonnet-latest";

/**
 * Drain one run's assistant stream to stdout and hand back the text.
 *
 * Extracted because the loop is the same in every template and nests three deep inside whatever
 * calls it — reading it once here beats re-reading it inside each caller.
 */
async function streamReply(run: Run): Promise<string> {
  let text = "";
  for await (const event of run.stream()) {
    if (event.type !== "assistant") continue;
    for (const part of event.message.content) {
      if (part.type === "text") {
        process.stdout.write(part.text);
        text += part.text;
      }
    }
  }
  return text;
}

async function main(): Promise<void> {
  // Default backend is SQLite with full-text search and no native dependency.
  // Add `embedding: { provider: "openai" }` for hybrid vector recall, or
  // `backend: "lance"` (which then REQUIRES an embedding runtime).
  const index = await Memory.openIndex({ cwd: process.cwd() });

  try {
    const synced = await index.sync();
    console.log(
      `Indexed ${synced.filesScanned} file(s) · ${synced.chunksWritten} chunk(s) written · ` +
        `backend ${index.status().backend}`,
    );

    if (index.status().chunksIndexed === 0) {
      // Saying this up front is the difference between "the model is bad" and
      // "there was nothing to retrieve".
      console.warn(
        "\nThe index is empty. Put some markdown under .theokit/memory/ and re-run,\n" +
          "otherwise the agent has nothing to cite and will say so.\n",
      );
    }

    const searchKnowledge = Tool.create({
      name: "search_knowledge",
      description:
        "Search the local knowledge base and return matching snippets with citations. " +
        "Call this before answering any question about the user's own documents.",
      inputSchema: z.object({
        query: z.string().describe("What to look for, in natural language."),
        maxResults: z.number().int().min(1).max(20).default(5),
      }),
      handler: async ({ query, maxResults }) => {
        // `sources` belongs to the SEARCH, not to opening the index: it narrows
        // which corpora this one query reads.
        const hits = await index.search(query, {
          maxResults,
          sources: ["memory", "wiki"],
        });
        if (hits.length === 0) return "No matching documents.";
        return hits
          .map((h, i) => `[${i + 1}] ${h.citation} (score ${h.score.toFixed(2)})\n${h.snippet}`)
          .join("\n\n");
      },
    });

    const agent = await Agent.create({
      agentId: "rag-agent",
      apiKey: API_KEY,
      model: { id: MODEL },
      systemPrompt:
        "Answer from the local knowledge base. Call search_knowledge first, cite the " +
        "sources it returns by their [n] markers, and say plainly when the base does " +
        "not contain the answer rather than filling the gap from memory.",
      tools: [searchKnowledge],
      local: { cwd: process.cwd() },
    });

    try {
      const question = process.argv[2] ?? "What is in this knowledge base?";
      console.log(`\nQuestion: ${question}\n`);

      const run = await agent.send(question);
      await streamReply(run);
      const result = await run.wait();
      process.stdout.write("\n");
      if (result.status === "error") {
        console.error(`\nrun failed: ${result.error?.message ?? "no reason reported"}`);
        process.exitCode = 1;
      }
    } finally {
      await agent.dispose();
    }
  } finally {
    await index.close();
  }
}

main().catch((cause) => {
  console.error("rag-agent failed:", cause instanceof Error ? cause.message : cause);
  process.exit(1);
});

/**
 * TheoKit Chatbot — conversational agent with memory.
 *
 * Demonstrates Agent.create, agent.send, streaming replies,
 * and conversation persistence via FileSystemConversationStorage.
 */

import * as readline from "node:readline";
import { Agent, FileSystemConversationStorage } from "@theokit/sdk";

const AGENT_ID = "chatbot-demo";

const agent = await Agent.create({
  agentId: AGENT_ID,
  apiKey: process.env.THEOKIT_API_KEY ?? "local",
  model: { id: process.env.AGENT_MODEL ?? "anthropic/claude-3-5-sonnet-latest" },
  systemPrompt:
    "You are a friendly assistant. Keep answers concise (1-3 sentences). " +
    "Remember context from earlier in the conversation.",
  local: {
    cwd: process.cwd(),
    conversationStorage: new FileSystemConversationStorage({
      directory: ".theokit/conversations",
    }),
  },
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("TheoKit Chatbot ready. Type a message (Ctrl+C to quit).\n");

function prompt(): void {
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: interactive REPL loop with stream + error handling
  rl.question("You: ", async (input) => {
    const text = input.trim();
    if (text.length === 0) {
      prompt();
      return;
    }

    const run = await agent.send(text);
    let _reply = "";

    for await (const event of run.stream()) {
      if (event.type !== "assistant") continue;
      for (const part of event.message.content) {
        if (part.type === "text") {
          process.stdout.write(part.text);
          _reply += part.text;
        }
      }
    }

    await run.wait();
    console.log("\n");
    prompt();
  });
}

prompt();

process.on("SIGINT", () => {
  agent.dispose();
  rl.close();
  process.exit(0);
});

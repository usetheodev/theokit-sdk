/**
 * TheoKit Multi-Agent — container with classifier, summarizer, and translator.
 *
 * Demonstrates TheoKitContainer for managing multiple agents from a
 * single registry. A classifier routes input to the right specialist,
 * the summarizer condenses text, and the translator handles i18n.
 */

import { Agent, TheoKitContainer } from "@theokit/sdk";

const API_KEY = process.env.THEOKIT_API_KEY ?? "local";
const MODEL = process.env.AGENT_MODEL ?? "anthropic/claude-3-5-sonnet-latest";

// 1. Define a container with three specialist agents.
const container = new TheoKitContainer({
  agents: {
    classifier: {
      model: MODEL,
      systemPrompt:
        "You are a text classifier. Given input text, respond with exactly one word: " +
        '"summarize" if the user wants a summary, "translate" if they want translation, ' +
        'or "general" for anything else.',
    },
    summarizer: {
      model: MODEL,
      systemPrompt:
        "You are a summarization specialist. Condense the given text into " +
        "2-3 key bullet points. Be concise and precise.",
    },
    translator: {
      model: MODEL,
      systemPrompt:
        "You are a translation specialist. Translate the given text to the " +
        "target language specified by the user. If no language is specified, " +
        "translate to English.",
    },
  },
});

// 2. Helper to send a message to a named agent and collect the reply.
async function ask(agentName: string, message: string): Promise<string> {
  const config = container.agent(agentName);
  const agent = await Agent.create({
    agentId: `multi-${agentName}`,
    apiKey: API_KEY,
    model: { id: config.model },
    systemPrompt: config.systemPrompt as string,
    local: { cwd: process.cwd() },
  });

  const run = await agent.send(message);
  let reply = "";
  for await (const event of run.stream()) {
    if (event.type === "assistant") {
      for (const part of event.message.content) {
        if (part.type === "text") reply += part.text;
      }
    }
  }
  await run.wait();
  agent.dispose();
  return reply.trim();
}

// 3. Route input through the classifier, then dispatch to the specialist.
const input = process.argv[2] ?? "Summarize: The quick brown fox jumps over the lazy dog.";
console.log(`Input: ${input}\n`);

const classification = await ask("classifier", input);
console.log(`Classifier decision: ${classification}\n`);

const specialist = classification === "translate" ? "translator" : "summarizer";
const result = await ask(specialist, input);
console.log(`${specialist} response:\n${result}\n`);

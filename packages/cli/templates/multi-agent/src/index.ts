/**
 * {{projectName}} — a router and two specialists.
 *
 * A classifier reads the input and names the specialist; that specialist answers.
 * All three share one configuration prefix through `AgentFactory`, so the only
 * thing that varies per agent is its system prompt.
 */

import { AgentFactory, type Run } from "@theokit/sdk";

const API_KEY = process.env.THEOKIT_API_KEY ?? "local";
const MODEL = process.env.AGENT_MODEL ?? "anthropic/claude-3-5-sonnet-latest";

/** The whole difference between the three agents. */
const SPECIALISTS = {
  classifier:
    'Reply with exactly one word and nothing else: "summarize" if the user wants a ' +
    'summary, "translate" if they want a translation, otherwise "summarize".',
  summarizer: "Condense the input into two or three bullet points. No preamble.",
  translator:
    "Translate the input to the language the user names. If none is named, " +
    "translate to English. Reply with the translation only.",
} as const;

type Specialist = keyof typeof SPECIALISTS;

// One prefix, many agents — this is what `AgentFactory` is for. Writing
// `Agent.create` three times would drift the shared half apart on the first edit.
const factory = AgentFactory.create({
  apiKey: API_KEY,
  model: { id: MODEL },
  local: { cwd: process.cwd() },
});

/**
 * Drain one run's assistant stream and hand back the text.
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
        text += part.text;
      }
    }
  }
  return text;
}

async function ask(role: Specialist, message: string): Promise<string> {
  // `forSession` — a fresh agent per call. Use `getOrCreate` instead when the
  // specialist should remember earlier turns.
  const agent = await factory.forSession(`multi-${role}`, {
    systemPrompt: SPECIALISTS[role],
  });
  try {
    const run = await agent.send(message);
    const reply = await streamReply(run);
    const result = await run.wait();
    if (result.status === "error") {
      throw new Error(`${role} failed: ${result.error?.message ?? "no reason reported"}`);
    }
    return reply.trim();
  } finally {
    await agent.dispose();
  }
}

async function main(): Promise<void> {
  const input = process.argv[2] ?? "Summarize: the quick brown fox jumps over the lazy dog.";
  console.log(`Input: ${input}\n`);

  const verdict = (await ask("classifier", input)).toLowerCase();
  // The model is asked for one word and usually gives one. `includes` rather
  // than `===` so a stray period or quote does not silently route everything
  // to the fallback — the failure would look like a bad classifier.
  const role: Specialist = verdict.includes("translate") ? "translator" : "summarizer";
  console.log(`Router chose: ${role} (said "${verdict}")\n`);

  console.log(await ask(role, input));
}

main().catch((cause) => {
  console.error("multi-agent failed:", cause instanceof Error ? cause.message : cause);
  process.exit(1);
});

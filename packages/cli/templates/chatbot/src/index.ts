/**
 * {{projectName}} — a conversational agent that remembers.
 *
 * Reads a line, streams the reply, and keeps the thread going. Every finished
 * turn is persisted automatically, so the conversation survives a restart —
 * there is nothing to wire for that. `local.sessionDir` only chooses WHERE the
 * transcript lives; point it at `~/.claude` and the Claude Code CLI can
 * `--continue` the same session.
 */

import { createInterface } from "node:readline/promises";
import { Agent, type Run } from "@theokit/sdk";

const API_KEY = process.env.THEOKIT_API_KEY ?? "local";
const MODEL = process.env.AGENT_MODEL ?? "anthropic/claude-3-5-sonnet-latest";

/** A stable id is what makes the next run resume this conversation instead of starting a new one. */
const AGENT_ID = process.env.AGENT_ID ?? "chatbot";

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
  // `getOrCreate` — not `create`. On a second run it reattaches to the stored
  // transcript for this id; `create` would start a fresh thread each time.
  const agent = await Agent.getOrCreate(AGENT_ID, {
    apiKey: API_KEY,
    model: { id: MODEL },
    local: {
      cwd: process.cwd(),
      ...(process.env.SESSION_DIR !== undefined ? { sessionDir: process.env.SESSION_DIR } : {}),
    },
    systemPrompt:
      "You are a friendly assistant. Keep answers to one to three sentences, " +
      "and use what was said earlier in the conversation.",
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(`${AGENT_ID} ready · model ${MODEL} · Ctrl+C to quit\n`);

  // A `for await` over the prompt, not a recursive callback: the loop below
  // reads as the conversation it is, and an error in one turn does not bury the
  // stack under every turn before it.
  try {
    while (true) {
      const line = (await rl.question("You: ")).trim();
      if (line.length === 0) continue;

      const run = await agent.send(line);
      process.stdout.write("Bot: ");
      await streamReply(run);

      const result = await run.wait();
      process.stdout.write("\n\n");

      // A run can END without succeeding. Reporting the reason here is the
      // difference between "the bot went quiet" and a diagnosis.
      if (result.status === "error") {
        console.error(`run failed: ${result.error?.message ?? "no reason reported"}\n`);
      }
    }
  } finally {
    rl.close();
    await agent.dispose();
  }
}

main().catch((cause) => {
  console.error("chatbot failed:", cause instanceof Error ? cause.message : cause);
  process.exit(1);
});

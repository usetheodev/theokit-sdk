/**
 * Template registry for `theokit init` (T2.1, ADR D200).
 *
 * Seven templates ship: `minimal`, `ollama-local`, `chatbot`, `multi-agent`,
 * `rag-agent`, `workflow-automation`, `telegram-bot`.
 * Each is a literal directory copied to `<dest>/` at scaffold time, with
 * `{{projectName}}` and `{{sdkVersion}}` substituted in text files.
 *
 * @internal
 */

interface TemplateMeta {
  readonly name: string;
  readonly description: string;
  readonly hint: string;
}

export const TEMPLATES: ReadonlyArray<TemplateMeta> = [
  {
    name: "minimal",
    description: "Smallest possible agent — one Agent.create + send + stream.",
    hint: "Set ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY in .env.",
  },
  {
    name: "ollama-local",
    description: "100% local agent via Ollama (no remote API key required).",
    hint: "Requires `ollama serve` + `ollama pull llama3.2:3b`.",
  },
  {
    name: "chatbot",
    description: "Conversational agent that resumes its own thread across runs.",
    hint: "SESSION_DIR=~/.claude writes sessions the Claude Code CLI can --continue.",
  },
  {
    name: "multi-agent",
    description: "A classifier routes to specialists, all from one AgentFactory prefix.",
    hint: 'Pass the input as an argument: `pnpm dev "Translate to French: hello"`.',
  },
  {
    name: "rag-agent",
    description: "Retrieval over your own files — Memory.openIndex behind a Tool.",
    hint: "Put markdown under .theokit/memory/ first, or there is nothing to cite.",
  },
  {
    name: "workflow-automation",
    description: "A committed Workflow (fn -> agentStep -> fn) handed to Cron.",
    hint: "WORKFLOW_CRON overrides the schedule; default is every 5 minutes.",
  },
  {
    name: "telegram-bot",
    description: "Telegram bot via @theokit/gateway + grammy.",
    hint: "Get a bot token from @BotFather, set TELEGRAM_BOT_TOKEN in .env.",
  },
] as const;

export function findTemplate(name: string): TemplateMeta | undefined {
  return TEMPLATES.find((t) => t.name === name);
}

export const DEFAULT_TEMPLATE = "minimal";

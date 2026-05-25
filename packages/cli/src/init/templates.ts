/**
 * Template registry for `theokit init` (T2.1, ADR D200).
 *
 * Three templates ship at v1: `minimal`, `ollama-local`, `telegram-bot`.
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
    name: "telegram-bot",
    description: "Telegram bot via @usetheo/gateway + grammy.",
    hint: "Get a bot token from @BotFather, set TELEGRAM_BOT_TOKEN in .env.",
  },
] as const;

export function findTemplate(name: string): TemplateMeta | undefined {
  return TEMPLATES.find((t) => t.name === name);
}

export const DEFAULT_TEMPLATE = "minimal";

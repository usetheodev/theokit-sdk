import { type AgentFactory, createAgentFactory, type SDKAgent } from "@theokit/sdk";
import type { Context } from "grammy";

import { buildMcpServers, buildProviderRouting } from "./sdk-config.js";
import { TELEGRAM_PRO_SUBAGENTS } from "./subagents.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { TELEGRAM_PRO_CUSTOM_TOOLS } from "./tools-registry.js";

export { SYSTEM_PROMPT } from "./system-prompt.js";
export { TELEGRAM_PRO_CUSTOM_TOOLS } from "./tools-registry.js";

/**
 * Thread-aware per-chat agent factory.
 *
 * Identity rules:
 *  - DM       → agentId = `tg-pro-dm-<userId>`             (one shared thread per user)
 *  - Group    → agentId = `tg-pro-grp-<chatId>-<userId>`   (one per user inside the group)
 *  - Topic    → agentId = `tg-pro-tpc-<chatId>-<threadId>` (one per forum topic)
 *
 * Refactor (Phase 5 of agent-construction-dx-helpers): switched from manual
 * try/catch resume + cold-create to `createAgentFactory` (ADR D23) + the
 * factory's `getOrCreate` which calls `Agent.getOrCreate` under the hood.
 * The factory captures shared config once at module load; `getAgent()` per
 * Telegram update only resolves the chat-scoped IDs and per-user overrides.
 */

export function resolveUserId(ctx: Context): string {
  if (ctx.from?.id !== undefined) return String(ctx.from.id);
  if (ctx.chat?.id !== undefined) return String(ctx.chat.id);
  return "anonymous";
}

export function resolveAgentId(ctx: Context): string {
  const userId = resolveUserId(ctx);
  const chat = ctx.chat;
  if (chat === undefined || chat.type === "private") {
    return `tg-pro-dm-${userId}`;
  }
  const threadId = ctx.message?.message_thread_id ?? ctx.callbackQuery?.message?.message_thread_id;
  if (typeof threadId === "number") {
    return `tg-pro-tpc-${chat.id}-${threadId}`;
  }
  return `tg-pro-grp-${chat.id}-${userId}`;
}

export interface AgentFactoryOptions {
  apiKey: string;
  cwd: string;
}

let cachedFactory: AgentFactory | undefined;

function getFactory(opts: AgentFactoryOptions): AgentFactory {
  if (cachedFactory !== undefined) return cachedFactory;
  const providers = buildProviderRouting();
  const mcpServers = buildMcpServers(opts.cwd);
  // ADR D182/D186: developers running locally can override the model id
  // via `TELEGRAM_PRO_MODEL` (e.g. `ollama/llama3.2:3b` for fully-local
  // operation). Default stays gemini-flash for the OpenRouter happy path.
  const modelId = process.env.TELEGRAM_PRO_MODEL ?? "google/gemini-2.0-flash-001";
  cachedFactory = createAgentFactory({
    apiKey: opts.apiKey,
    model: { id: modelId },
    local: {
      cwd: opts.cwd,
      settingSources: ["project", "plugins"],
      sandboxOptions: { enabled: true },
    },
    agents: TELEGRAM_PRO_SUBAGENTS,
    context: { manager: "file" },
    tools: TELEGRAM_PRO_CUSTOM_TOOLS,
    systemPrompt: SYSTEM_PROMPT,
    // Telemetry showcase (ADR D34): every agent.send / llm.call / tool.call
    // emits a span via @opentelemetry/api when installed. Privacy default —
    // NO content logged. Set TELEGRAM_PRO_TELEMETRY=off to disable.
    // Auto-instrumentation (ADR D42/D55): when `@langfuse/node`, `@sentry/node`,
    // or `posthog-node` are installed alongside the bot, the SDK auto-registers
    // their OTel exporters. Fail-open: nothing installed = console-only,
    // identical to v1.1 behavior.
    telemetry: process.env.TELEGRAM_PRO_TELEMETRY === "off"
      ? { enabled: false }
      : {
          enabled: true,
          autoDetect: true,
          exporter: "console",
          serviceName: "telegram-pro",
          includeContent: false,
        },
    ...(providers !== undefined ? { providers } : {}),
    ...(mcpServers !== undefined ? { mcpServers } : {}),
  });
  return cachedFactory;
}

/**
 * ADR D182/D183: in local-model mode, agents are LONG-LIVED. Returning an
 * agent with a NO-OP `dispose()` keeps the cached agent alive across
 * commands — re-creating per-handler costs 5-10s on Ollama (DB init,
 * memory load, MCP servers). The bot lifecycle handles cleanup at SIGTERM.
 */
function makeNonDisposingProxy(agent: SDKAgent): SDKAgent {
  return new Proxy(agent, {
    get(target, prop, receiver) {
      if (prop === "dispose") {
        return async () => undefined;
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export async function getAgent(ctx: Context, opts: AgentFactoryOptions): Promise<SDKAgent> {
  const agentId = resolveAgentId(ctx);
  const userId = resolveUserId(ctx);
  // ADR D182/D183: when running on a local Ollama model, disable active
  // recall (to avoid model-swap thrashing) AND strip the system prompt /
  // custom tools down to a minimal "concise reply" shape — small local
  // models (< 7B) choke on the production-grade bilingual prompt + 10+
  // tool descriptions. The bot still WRITES facts to memory (Remember:);
  // only the per-turn embedding-recall + LLM-side context is suppressed.
  const isLocalModel = /^(ollama|lmstudio|llamacpp)\//.test(
    process.env.TELEGRAM_PRO_MODEL ?? "",
  );
  const agent = await getFactory(opts).getOrCreate(agentId, {
    memory: {
      enabled: true,
      namespace: "tg-pro",
      scope: "user",
      userId,
      activeRecall: isLocalModel
        ? { enabled: false }
        : { enabled: true, queryMode: "recent" },
    },
    systemPrompt: isLocalModel
      ? "You are Theo, a helpful assistant on Telegram. Reply in one short sentence. Plain text only."
      : SYSTEM_PROMPT,
    tools: isLocalModel ? [] : TELEGRAM_PRO_CUSTOM_TOOLS,
  });
  // In local mode, suppress per-handler dispose() — keep agent warm across
  // commands so memory/MCP init cost is amortized once at bot boot.
  return isLocalModel ? makeNonDisposingProxy(agent) : agent;
}

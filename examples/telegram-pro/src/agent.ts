import { type AgentFactory, createAgentFactory, type SDKAgent } from "@usetheo/sdk";
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
  cachedFactory = createAgentFactory({
    apiKey: opts.apiKey,
    model: { id: "google/gemini-2.0-flash-001" },
    local: {
      cwd: opts.cwd,
      settingSources: ["project", "plugins"],
      sandboxOptions: { enabled: true },
    },
    agents: TELEGRAM_PRO_SUBAGENTS,
    context: { manager: "file" },
    tools: TELEGRAM_PRO_CUSTOM_TOOLS,
    systemPrompt: SYSTEM_PROMPT,
    ...(providers !== undefined ? { providers } : {}),
    ...(mcpServers !== undefined ? { mcpServers } : {}),
  });
  return cachedFactory;
}

export async function getAgent(ctx: Context, opts: AgentFactoryOptions): Promise<SDKAgent> {
  const agentId = resolveAgentId(ctx);
  const userId = resolveUserId(ctx);
  return getFactory(opts).getOrCreate(agentId, {
    memory: {
      enabled: true,
      namespace: "tg-pro",
      scope: "user",
      userId,
      activeRecall: { enabled: true, queryMode: "recent" },
    },
    // Re-supply systemPrompt + tools on every resume so prompt/handler changes
    // shipped in bot updates reach existing users (handlers are not persisted).
    systemPrompt: SYSTEM_PROMPT,
    tools: TELEGRAM_PRO_CUSTOM_TOOLS,
  });
}

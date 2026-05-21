import { type AgentFactory, createAgentFactory, type SDKAgent } from "@usetheo/sdk";
import type { Message } from "discord.js";

import { buildMcpServers, buildProviderRouting } from "./sdk-config.js";
import { DISCORD_PRO_SUBAGENTS } from "./subagents.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { DISCORD_PRO_CUSTOM_TOOLS } from "./tools-registry.js";

export { SYSTEM_PROMPT } from "./system-prompt.js";
export { DISCORD_PRO_CUSTOM_TOOLS } from "./tools-registry.js";

/**
 * Per-channel agent factory for Discord.
 *
 * Identity rules:
 *  - DM       → agentId = `dc-pro-dm-<userId>`
 *  - Guild    → agentId = `dc-pro-grp-<channelId>-<userId>`
 *  - Thread   → agentId = `dc-pro-tpc-<channelId>-<threadId>`
 */

export function resolveUserId(msg: Message): string {
  return msg.author.id;
}

export function resolveAgentId(msg: Message): string {
  const userId = resolveUserId(msg);
  if (msg.guildId === null) return `dc-pro-dm-${userId}`;
  if (msg.channel.isThread()) return `dc-pro-tpc-${msg.channelId}-${msg.channel.id}`;
  return `dc-pro-grp-${msg.channelId}-${userId}`;
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
    agents: DISCORD_PRO_SUBAGENTS,
    context: { manager: "file" },
    tools: DISCORD_PRO_CUSTOM_TOOLS,
    systemPrompt: SYSTEM_PROMPT,
    telemetry:
      process.env.DISCORD_PRO_TELEMETRY === "off"
        ? { enabled: false }
        : {
            enabled: true,
            autoDetect: true,
            exporter: "console",
            serviceName: "discord-pro",
            includeContent: false,
          },
    ...(providers !== undefined ? { providers } : {}),
    ...(mcpServers !== undefined ? { mcpServers } : {}),
  });
  return cachedFactory;
}

export async function getAgent(msg: Message, opts: AgentFactoryOptions): Promise<SDKAgent> {
  const agentId = resolveAgentId(msg);
  const userId = resolveUserId(msg);
  return getFactory(opts).getOrCreate(agentId, {
    memory: {
      enabled: true,
      namespace: "dc-pro",
      scope: "user",
      userId,
      activeRecall: { enabled: true, queryMode: "recent" },
    },
    systemPrompt: SYSTEM_PROMPT,
    tools: DISCORD_PRO_CUSTOM_TOOLS,
  });
}

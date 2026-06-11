import { stat } from "node:fs/promises";

import { AuthenticationError, ConfigurationError, UnknownAgentError } from "./errors.js";
import { validateApiKeyShape } from "./internal/auth/api-key-validator.js";
import { resolveApiKey } from "./internal/env.js";
import {
  getConfiguredBaseUrl,
  isFixtureApiKey,
  shouldUseRealLocalRuntime,
} from "./internal/fixture-mode.js";
import { httpRequest } from "./internal/http.js";
import { isLocalAgentId } from "./internal/ids.js";
import { CloudAgent } from "./internal/runtime/cloud-agent.js";
import { validateCloudToolParity } from "./internal/runtime/cloud-tool-parity.js";
import { LocalAgent } from "./internal/runtime/local-agent.js";
import {
  flushRegistrySaves,
  getRegisteredAgent,
  hydrateRegistryFromDisk,
  updateRegisteredAgent,
} from "./internal/runtime/registry/agent-registry.js";
import { validateAgentOptions } from "./internal/runtime/validate-agent-options.js";
import type { OTelSpan } from "./internal/telemetry/tracer.js";
import type { AgentOptions, CustomTool, SDKAgent, SDKAgentInfo } from "./types/agent.js";

// ───── agent creation helpers ─────────────────────────────────────────

/** @internal */
export async function runCreateUnderSpan(options: AgentOptions, span: OTelSpan): Promise<SDKAgent> {
  validateAgentOptions(options);
  validateCloudToolParity(options);
  await guardAgainstIdCollision(options);
  await runOnBeforeCreateGate(options);
  const optionsWithHandoffs = await maybeInjectHandoffTools(options);
  const agent =
    optionsWithHandoffs.cloud !== undefined
      ? await createCloudAgent(optionsWithHandoffs)
      : await createLocalAgent(optionsWithHandoffs);
  span.setAttribute("agentId", agent.agentId);
  span.setAttribute("workspaceCwd", resolveWorkspaceCwdForAttr(optionsWithHandoffs.local?.cwd));
  return agent;
}

async function guardAgainstIdCollision(options: AgentOptions): Promise<void> {
  if (options.agentId === undefined) return;
  const persistenceCwd = resolveAgentPersistenceCwd(options);
  await hydrateRegistryFromDisk(persistenceCwd);
  if (getRegisteredAgent(options.agentId) !== undefined) {
    throw new ConfigurationError(
      `Agent "${options.agentId}" already exists. Use Agent.resume("${options.agentId}") to reattach, or pick a different agentId.`,
      { code: "agent_id_already_exists" },
    );
  }
}

async function runOnBeforeCreateGate(options: AgentOptions): Promise<void> {
  if (options.onBeforeCreate === undefined) return;
  const userId = typeof options.metadata?.userId === "string" ? options.metadata.userId : undefined;
  await options.onBeforeCreate({
    conversationId: options.agentId ?? "auto",
    ...(userId !== undefined ? { userId } : {}),
  });
}

function resolveWorkspaceCwdForAttr(cwd: string | string[] | undefined): string {
  if (Array.isArray(cwd)) return cwd[0] ?? process.cwd();
  return cwd ?? process.cwd();
}

function providerFromModelId(modelId: string | undefined): string | undefined {
  if (modelId === undefined) return undefined;
  const slash = modelId.indexOf("/");
  if (slash <= 0) return undefined;
  return modelId.slice(0, slash);
}

/** @internal */
export async function maybeInjectHandoffTools(options: AgentOptions): Promise<AgentOptions> {
  const handoffs = options.handoffs;
  if (handoffs === undefined || handoffs.length === 0) return options;
  if (options.maxHandoffDepth === 0) return options;

  interface ToolInjectorModule {
    normalizeHandoffs(
      parentAgentId: string,
      entries: ReadonlyArray<unknown>,
    ): ReadonlyArray<{ descriptor: unknown }>;
    buildHandoffTool(parentAgentId: string, descriptor: unknown, maxDepth: number): CustomTool;
  }
  let mod: ToolInjectorModule;
  try {
    mod = (await import("@theokit/sdk-handoff/internal/tool-injector")) as ToolInjectorModule;
  } catch (err) {
    throw new ConfigurationError(
      "Agent.create({ handoffs: [...] }) requires @theokit/sdk-handoff. " +
        "Install it: pnpm add @theokit/sdk-handoff. " +
        "Or migrate to the preferred plugin pattern: " +
        "plugins: [Handoff.asPlugin({ targets: [...] })] (see docs/migration/1-x-to-2-0.md#handoff).",
      { code: "handoff_package_missing", cause: err },
    );
  }
  const parentAgentId = options.agentId ?? options.name ?? "anonymous";
  const normalized = mod.normalizeHandoffs(parentAgentId, handoffs);
  const maxDepth = options.maxHandoffDepth ?? 5;
  const handoffTools = normalized.map(({ descriptor }) =>
    mod.buildHandoffTool(parentAgentId, descriptor, maxDepth),
  );
  const existingTools = options.tools ?? [];
  return {
    ...options,
    tools: [...existingTools, ...handoffTools],
  };
}

/** @internal */
export async function createLocalAgent(options: AgentOptions): Promise<SDKAgent> {
  const apiKey = resolveApiKey(options.apiKey);
  if (apiKey === undefined) {
    throw new AuthenticationError("Missing API key", { code: "missing_api_key" });
  }
  const willFlowToProvider = !isFixtureApiKey(apiKey) && !shouldUseRealLocalRuntime(apiKey);
  const shape = validateApiKeyShape(apiKey, {
    strict: willFlowToProvider,
    ...(willFlowToProvider ? { provider: providerFromModelId(options.model?.id) } : {}),
  });
  if (shape.malformed) {
    throw new AuthenticationError(shape.message, { code: "malformed_api_key" });
  }
  if (
    !isFixtureApiKey(apiKey) &&
    getConfiguredBaseUrl() === undefined &&
    !shouldUseRealLocalRuntime(apiKey)
  ) {
    throw new AuthenticationError("Invalid API key", {
      code: "authentication_error",
    });
  }
  const agent = new LocalAgent(options);
  await agent.initialize();
  return agent;
}

/** @internal */
export async function createCloudAgent(options: AgentOptions): Promise<SDKAgent> {
  const apiKey = resolveApiKey(options.apiKey);
  if (apiKey === undefined) {
    throw new ConfigurationError("Missing API key for cloud agent", {
      code: "missing_api_key",
    });
  }
  const shape = validateApiKeyShape(apiKey);
  if (shape.malformed) {
    throw new AuthenticationError(shape.message, { code: "malformed_api_key" });
  }

  const baseUrl = getConfiguredBaseUrl();
  if (baseUrl === undefined) {
    return new CloudAgent(options);
  }

  type CreateResponse = { agentId: string; model?: { id: string } };
  const response = await httpRequest<CreateResponse>("/v1/agents", {
    apiKey,
    method: "POST",
    body: {
      model: options.model,
      name: options.name,
      cloud: options.cloud,
      mcpServers: options.mcpServers,
      agents: options.agents,
    },
  });
  const mergedOptions: AgentOptions = {
    ...options,
    agentId: response.agentId,
    ...(response.model !== undefined ? { model: response.model } : {}),
  };
  return new CloudAgent(mergedOptions, response.agentId);
}

// ───── resume/rehydrate helpers ───────────────────────────────────────

/** @internal */
export function resolveAgentPersistenceCwd(options: Partial<AgentOptions>): string {
  const localCwd = options.local?.cwd;
  if (typeof localCwd === "string") return localCwd;
  if (Array.isArray(localCwd) && typeof localCwd[0] === "string") return localCwd[0];
  return process.cwd();
}

/** @internal */
export type RegisteredAgent = ReturnType<typeof getRegisteredAgent> & object;

/** @internal */
export async function rehydrateExistingAgent(
  agentId: string,
  existing: RegisteredAgent,
  options: Partial<AgentOptions>,
): Promise<SDKAgent> {
  await validateRehydratedAgent(agentId, existing);
  if (existing.requiresCustomStorage === true && options.conversationStorage === undefined) {
    throw new ConfigurationError(
      `Agent "${agentId}" was created with a custom conversationStorage adapter; pass conversationStorage again on resume to avoid losing history.`,
      { code: "conversation_storage_required" },
    );
  }
  const mergedLocal =
    options.local !== undefined && existing.options.local !== undefined
      ? { ...existing.options.local, ...options.local }
      : (options.local ?? existing.options.local);
  const mergedOptions: AgentOptions = {
    ...existing.options,
    ...options,
    ...(mergedLocal !== undefined ? { local: mergedLocal } : {}),
    mcpServers: undefined,
    agentId,
  };
  if (existing.runtime === "cloud") {
    return new CloudAgent(mergedOptions, agentId);
  }
  const agent = new LocalAgent({ ...mergedOptions, model: existing.options.model });
  await agent.initialize();
  return agent;
}

async function validateRehydratedAgent(
  agentId: string,
  entry: { runtime: "local" | "cloud"; cwd?: string; options: AgentOptions },
): Promise<void> {
  if (entry.runtime !== "local") return;
  const candidate = entry.options.local?.cwd ?? entry.cwd;
  if (typeof candidate !== "string") return;
  try {
    const info = await stat(candidate);
    if (!info.isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${candidate}`);
    }
  } catch (cause) {
    throw new UnknownAgentError(
      `Agent "${agentId}" cannot be rehydrated — workspace cwd "${candidate}" is missing or inaccessible.`,
      { code: "agent_rehydration_failed", cause },
    );
  }
}

// ───── registry info helpers ──────────────────────────────────────────

/** @internal */
export function toAgentInfo(agent: RegisteredAgent): SDKAgentInfo {
  return isLocalAgentId(agent.agentId) ? toLocalAgentInfo(agent) : toCloudAgentInfo(agent);
}

function commonAgentInfo(agent: RegisteredAgent, fallbackSummary: string) {
  return {
    agentId: agent.agentId,
    name: agent.name ?? "Untitled agent",
    summary: agent.summary ?? fallbackSummary,
    lastModified: agent.lastModified,
    createdAt: agent.createdAt,
    ...(agent.status !== undefined ? { status: agent.status } : {}),
  };
}

function toLocalAgentInfo(agent: RegisteredAgent): SDKAgentInfo {
  return {
    ...commonAgentInfo(agent, "Local contract fixture"),
    runtime: "local",
    ...(agent.cwd !== undefined ? { cwd: agent.cwd } : {}),
  };
}

function toCloudAgentInfo(agent: RegisteredAgent): SDKAgentInfo {
  return {
    ...commonAgentInfo(agent, "Cloud contract fixture"),
    archived: agent.archived,
    runtime: "cloud",
    env: { type: "cloud" },
    ...(agent.repos !== undefined ? { repos: agent.repos } : {}),
  };
}

/** @internal */
export async function setArchivedFlag(agentId: string, archived: boolean): Promise<void> {
  await getRegisteredAgentOrThrow(agentId);
  updateRegisteredAgent(agentId, { archived });
  await flushRegistrySaves();
}

/** @internal */
export async function getRegisteredAgentOrThrow(agentId: string): Promise<RegisteredAgent> {
  let agent = getRegisteredAgent(agentId);
  if (agent === undefined) {
    await hydrateRegistryFromDisk(process.cwd());
    agent = getRegisteredAgent(agentId);
  }
  if (agent === undefined) {
    throw new UnknownAgentError(`Agent ${agentId} not found`, { code: "unknown_agent" });
  }
  return agent;
}

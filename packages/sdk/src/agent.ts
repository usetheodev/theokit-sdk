import { AuthenticationError, ConfigurationError, UnknownAgentError } from "./errors.js";
import { resolveApiKey } from "./internal/env.js";
import {
  getConfiguredBaseUrl,
  isFixtureApiKey,
  shouldUseRealLocalRuntime,
} from "./internal/fixture-mode.js";
import { httpRequest } from "./internal/http.js";
import { isCloudAgentId, isLocalAgentId } from "./internal/ids.js";
import {
  getRegisteredAgent,
  listRegisteredAgents,
  removeRegisteredAgent,
  updateRegisteredAgent,
} from "./internal/runtime/agent-registry.js";
import { CloudAgent } from "./internal/runtime/cloud-agent.js";
import { LocalAgent } from "./internal/runtime/local-agent.js";
import { getRun as getRegisteredRun, listRunsByAgent } from "./internal/runtime/run-registry.js";
import { createHistoricalCloudRun, createStubRun } from "./internal/runtime/stub-run.js";
import { validateAgentOptions } from "./internal/runtime/validate-agent-options.js";
import type {
  AgentOperationOptions,
  AgentOptions,
  GetAgentOptions,
  GetRunOptions,
  ListAgentsOptions,
  ListResult,
  ListRunsOptions,
  SDKAgent,
  SDKAgentInfo,
} from "./types/agent.js";
import type { Run, RunResult } from "./types/run.js";

/**
 * Result of a one-shot {@link Agent.prompt} call.
 *
 * @public
 */
export type AgentPromptResult = RunResult;

/**
 * Static façade for creating and managing Theo agents.
 *
 * @public
 */
export class Agent {
  private constructor() {
    // Static-only façade.
  }

  /**
   * Create a new agent. Pass either `local` or `cloud` to pick a runtime.
   *
   * @public
   */
  static async create(options: AgentOptions): Promise<SDKAgent> {
    validateAgentOptions(options);
    if (options.cloud !== undefined) {
      return createCloudAgent(options);
    }
    return createLocalAgent(options);
  }

  /**
   * One-shot prompt: create an agent, send a single message, wait, dispose.
   *
   * @public
   */
  static async prompt(message: string, options: AgentOptions): Promise<AgentPromptResult> {
    const agent = await Agent.create(options);
    try {
      const run = await agent.send(message);
      return await run.wait();
    } finally {
      await agent.dispose();
    }
  }

  /**
   * Reattach to an existing agent by ID.
   *
   * @public
   */
  static async resume(agentId: string, options: Partial<AgentOptions> = {}): Promise<SDKAgent> {
    const existing = getRegisteredAgent(agentId);
    if (existing !== undefined) {
      // Strip inline mcpServers — they don't persist across resume.
      const mergedOptions: AgentOptions = {
        ...existing.options,
        ...options,
        mcpServers: undefined,
        agentId,
      };
      if (existing.runtime === "cloud") {
        return new CloudAgent(mergedOptions, agentId);
      }
      return new LocalAgent({ ...mergedOptions, model: existing.options.model });
    }
    if (isCloudAgentId(agentId)) {
      return new CloudAgent({ ...options, agentId } as AgentOptions, agentId);
    }
    return new LocalAgent({ ...options, agentId } as AgentOptions);
  }

  /**
   * List agents (local or cloud).
   *
   * @public
   */
  static async list(options: ListAgentsOptions = {}): Promise<ListResult<SDKAgentInfo>> {
    const runtime = options.runtime;
    const all = listRegisteredAgents(runtime);
    const items = all.map((agent) => toAgentInfo(agent));
    return { items };
  }

  /**
   * Get metadata for a single agent.
   *
   * @public
   */
  static async get(agentId: string, _options: GetAgentOptions = {}): Promise<SDKAgentInfo> {
    const agent = getRegisteredAgent(agentId);
    if (agent === undefined) {
      throw new UnknownAgentError(`Agent ${agentId} not found`, {
        code: "unknown_agent",
      });
    }
    return toAgentInfo(agent);
  }

  /**
   * List runs for an agent.
   *
   * @public
   */
  static async listRuns(agentId: string, _options: ListRunsOptions = {}): Promise<ListResult<Run>> {
    const agent = getRegisteredAgent(agentId);
    if (agent === undefined) {
      throw new UnknownAgentError(`Agent ${agentId} not found`, {
        code: "unknown_agent",
      });
    }
    return { items: listRunsByAgent(agentId) };
  }

  /**
   * Get a single run.
   *
   * @public
   */
  static async getRun(runId: string, options: GetRunOptions = {}): Promise<Run> {
    if (options.runtime === "cloud") {
      if (!("agentId" in options) || typeof options.agentId !== "string") {
        throw new ConfigurationError("Cloud getRun requires the parent agentId", {
          code: "missing_agent_id",
        });
      }
      return createHistoricalCloudRun(options.agentId, runId);
    }
    const existing = getRegisteredRun(runId);
    if (existing !== undefined) return existing;
    return createStubRun({ agentId: "agent-pending", status: "finished" });
  }

  /**
   * Archive a cloud agent.
   *
   * @public
   */
  static archive(agentId: string, _options: AgentOperationOptions = {}): Promise<void> {
    return setArchivedFlag(agentId, true);
  }

  /**
   * Restore an archived cloud agent.
   *
   * @public
   */
  static unarchive(agentId: string, _options: AgentOperationOptions = {}): Promise<void> {
    return setArchivedFlag(agentId, false);
  }

  /**
   * Permanently delete a cloud agent.
   *
   * @public
   */
  static async delete(agentId: string, _options: AgentOperationOptions = {}): Promise<void> {
    removeRegisteredAgent(agentId);
  }
}

async function createLocalAgent(options: AgentOptions): Promise<SDKAgent> {
  const apiKey = resolveApiKey(options.apiKey);
  if (apiKey === undefined) {
    throw new AuthenticationError("Missing API key", { code: "missing_api_key" });
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

async function createCloudAgent(options: AgentOptions): Promise<SDKAgent> {
  const apiKey = resolveApiKey(options.apiKey);
  if (apiKey === undefined) {
    throw new ConfigurationError("Missing API key for cloud agent", {
      code: "missing_api_key",
    });
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

type RegisteredAgent = ReturnType<typeof getRegisteredAgent> & object;

function toAgentInfo(agent: RegisteredAgent): SDKAgentInfo {
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

function setArchivedFlag(agentId: string, archived: boolean): Promise<void> {
  const agent = getRegisteredAgent(agentId);
  if (agent === undefined) {
    throw new UnknownAgentError(`Agent ${agentId} not found`, { code: "unknown_agent" });
  }
  updateRegisteredAgent(agentId, { archived });
  return Promise.resolve();
}

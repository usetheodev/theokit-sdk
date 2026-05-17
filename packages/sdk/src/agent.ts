import { stat } from "node:fs/promises";

import { AuthenticationError, ConfigurationError, UnknownAgentError } from "./errors.js";
import { resolveApiKey } from "./internal/env.js";
import {
  getConfiguredBaseUrl,
  isFixtureApiKey,
  shouldUseRealLocalRuntime,
} from "./internal/fixture-mode.js";
import { httpRequest } from "./internal/http.js";
import { isLocalAgentId } from "./internal/ids.js";
import {
  flushRegistrySaves,
  getRegisteredAgent,
  hydrateRegistryFromDisk,
  listRegisteredAgents,
  removeRegisteredAgent,
  updateRegisteredAgent,
} from "./internal/runtime/agent-registry.js";
import { CloudAgent } from "./internal/runtime/cloud-agent.js";
import { validateCloudToolParity } from "./internal/runtime/cloud-tool-parity.js";
import { LocalAgent } from "./internal/runtime/local-agent.js";
import { getRun as getRegisteredRun, listRunsByAgent } from "./internal/runtime/run-registry.js";
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
    validateCloudToolParity(options);
    // EC-1: when the caller pins an agentId, hydrate the persisted registry
    // first and reject collisions explicitly. Without this, restart + create
    // silently wipes the prior agent's metadata.
    if (options.agentId !== undefined) {
      const persistenceCwd = resolveAgentPersistenceCwd(options);
      await hydrateRegistryFromDisk(persistenceCwd);
      if (getRegisteredAgent(options.agentId) !== undefined) {
        throw new ConfigurationError(
          `Agent "${options.agentId}" already exists. Use Agent.resume("${options.agentId}") to reattach, or pick a different agentId.`,
          { code: "agent_id_already_exists" },
        );
      }
    }
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
    let existing = getRegisteredAgent(agentId);
    if (existing === undefined) {
      // D21: fall back to the persisted registry. Different cwds get isolated
      // registry.json files; we read the cwd the caller is operating in.
      const persistenceCwd = resolveAgentPersistenceCwd(options);
      await hydrateRegistryFromDisk(persistenceCwd);
      existing = getRegisteredAgent(agentId);
    }
    if (existing !== undefined) {
      await validateRehydratedAgent(agentId, existing);
      // Strip inline mcpServers — they don't persist across resume.
      // Deep-merge `local` so callers passing `local: { cwd }` keep the
      // persisted `settingSources` and `sandboxOptions`. The previous
      // shallow spread silently wiped these fields, which broke long-running
      // agents that depended on file-based hooks/skills.
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
    // Cold miss: throw UnknownAgentError so chat-assistant bots can
    // explicitly branch to `Agent.create({ agentId, ...full options })` on
    // first contact. The previous silent cold-create with the caller's
    // partial options was a footgun — it persisted incomplete agents
    // (no model, no system prompt) that then failed at first send.
    //
    // Migration: callers that want the OLD "always succeed" behaviour
    // should catch `UnknownAgentError` and call `Agent.create` themselves.
    throw new UnknownAgentError(
      `Agent "${agentId}" not found. Use Agent.create({ agentId, ... }) for first-time setup, or catch UnknownAgentError to branch resume-vs-create.`,
      { code: "unknown_agent" },
    );
  }

  /**
   * List agents (local or cloud).
   *
   * @public
   */
  static async list(options: ListAgentsOptions = {}): Promise<ListResult<SDKAgentInfo>> {
    await hydrateRegistryFromDisk(process.cwd());
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
    const agent = await getRegisteredAgentOrThrow(agentId);
    return toAgentInfo(agent);
  }

  /**
   * List runs for an agent.
   *
   * @public
   */
  static async listRuns(agentId: string, _options: ListRunsOptions = {}): Promise<ListResult<Run>> {
    await getRegisteredAgentOrThrow(agentId);
    return { items: listRunsByAgent(agentId) };
  }

  /**
   * Get a single run.
   *
   * @public
   */
  static async getRun(runId: string, options: GetRunOptions = {}): Promise<Run> {
    if (options.runtime === "cloud") {
      throw new ConfigurationError(
        "Cloud runtime is pre-release. Theo PaaS endpoints are not wired yet — getRun({ runtime: 'cloud' }) will be enabled when the PaaS ships.",
        { code: "cloud_runtime_pre_release" },
      );
    }
    const existing = getRegisteredRun(runId);
    if (existing !== undefined) return existing;
    throw new UnknownAgentError(
      `Run ${runId} is not in this process's registry. It may have been disposed, persisted in a previous process, or never created.`,
      { code: "run_not_found" },
    );
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
    await flushRegistrySaves();
  }
}

/**
 * Resolve the cwd used for persistence routing. Local agents pin a workspace
 * cwd via `options.local.cwd`; cloud agents and unspecified locals default to
 * `process.cwd()`. Matches the routing key set by `LocalAgent`/`CloudAgent`
 * constructors so disk reads and writes hit the same `<cwd>/.theokit/agents/registry.json`.
 *
 * @internal
 */
function resolveAgentPersistenceCwd(options: Partial<AgentOptions>): string {
  const localCwd = options.local?.cwd;
  if (typeof localCwd === "string") return localCwd;
  if (Array.isArray(localCwd) && typeof localCwd[0] === "string") return localCwd[0];
  return process.cwd();
}

/**
 * D21 validation: when rehydrating a persisted local agent, ensure the
 * recorded workspace cwd still exists on disk. Without this, a stale entry
 * would silently re-initialize against a missing path and fail mysteriously
 * deep inside the loader chain.
 *
 * @internal
 */
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

async function setArchivedFlag(agentId: string, archived: boolean): Promise<void> {
  await getRegisteredAgentOrThrow(agentId);
  updateRegisteredAgent(agentId, { archived });
  // Block until disk reflects the flip so subsequent reads observe it (D17).
  await flushRegistrySaves();
}

/**
 * Lookup a registered agent by ID, falling back to disk rehydration (ADR D21)
 * before throwing {@link UnknownAgentError}. Shared by the surfaces that need
 * the resume-aware contract (`get`, `listRuns`, `setArchivedFlag`).
 */
async function getRegisteredAgentOrThrow(agentId: string): Promise<RegisteredAgent> {
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

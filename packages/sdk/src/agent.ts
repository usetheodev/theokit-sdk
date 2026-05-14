import { ConfigurationError } from "./errors.js";
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

const NOT_IMPLEMENTED = "Not implemented yet — see CHANGELOG.md and docs.md";

/**
 * Result of a one-shot {@link Agent.prompt} call.
 *
 * @public
 */
export type AgentPromptResult = RunResult;

/**
 * Static façade for creating and managing Theo agents.
 *
 * The contract is defined in `docs.md` at the repository root. This class is a
 * static-only namespace; instantiation is intentionally blocked.
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
  static create(_options: AgentOptions): Promise<SDKAgent> {
    return Promise.reject(new ConfigurationError(`Agent.create: ${NOT_IMPLEMENTED}`));
  }

  /**
   * One-shot prompt: create an agent, send a single message, wait for the run
   * to finish, dispose.
   *
   * @public
   */
  static prompt(_message: string, _options: AgentOptions): Promise<AgentPromptResult> {
    return Promise.reject(new ConfigurationError(`Agent.prompt: ${NOT_IMPLEMENTED}`));
  }

  /**
   * Reattach to an existing agent by ID. Runtime is auto-detected from the ID
   * prefix (`bc-` is cloud, anything else is local).
   *
   * @public
   */
  static resume(_agentId: string, _options?: Partial<AgentOptions>): Promise<SDKAgent> {
    return Promise.reject(new ConfigurationError(`Agent.resume: ${NOT_IMPLEMENTED}`));
  }

  /**
   * List agents (local or cloud).
   *
   * @public
   */
  static list(_options?: ListAgentsOptions): Promise<ListResult<SDKAgentInfo>> {
    return Promise.reject(new ConfigurationError(`Agent.list: ${NOT_IMPLEMENTED}`));
  }

  /**
   * Get metadata for a single agent.
   *
   * @public
   */
  static get(_agentId: string, _options?: GetAgentOptions): Promise<SDKAgentInfo> {
    return Promise.reject(new ConfigurationError(`Agent.get: ${NOT_IMPLEMENTED}`));
  }

  /**
   * List runs for an agent.
   *
   * @public
   */
  static listRuns(_agentId: string, _options?: ListRunsOptions): Promise<ListResult<Run>> {
    return Promise.reject(new ConfigurationError(`Agent.listRuns: ${NOT_IMPLEMENTED}`));
  }

  /**
   * Get a single run.
   *
   * @public
   */
  static getRun(_runId: string, _options?: GetRunOptions): Promise<Run> {
    return Promise.reject(new ConfigurationError(`Agent.getRun: ${NOT_IMPLEMENTED}`));
  }

  /**
   * Archive a cloud agent. Soft-delete; transcript stays readable.
   *
   * @public
   */
  static archive(_agentId: string, _options?: AgentOperationOptions): Promise<void> {
    return Promise.reject(new ConfigurationError(`Agent.archive: ${NOT_IMPLEMENTED}`));
  }

  /**
   * Restore a previously archived cloud agent.
   *
   * @public
   */
  static unarchive(_agentId: string, _options?: AgentOperationOptions): Promise<void> {
    return Promise.reject(new ConfigurationError(`Agent.unarchive: ${NOT_IMPLEMENTED}`));
  }

  /**
   * Permanently delete a cloud agent.
   *
   * @public
   */
  static delete(_agentId: string, _options?: AgentOperationOptions): Promise<void> {
    return Promise.reject(new ConfigurationError(`Agent.delete: ${NOT_IMPLEMENTED}`));
  }
}

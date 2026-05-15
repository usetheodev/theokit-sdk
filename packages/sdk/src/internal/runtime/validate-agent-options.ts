import { ConfigurationError } from "../../errors.js";
import type {
  AgentDefinition,
  AgentOptions,
  CloudOptions,
} from "../../types/agent.js";
import type { McpServerConfig } from "../../types/mcp.js";

/**
 * Pre-flight validation for `Agent.create()` options. Throws
 * `ConfigurationError` on any rule violation; otherwise returns silently.
 *
 * Rules enforced:
 * - exactly one of local/cloud
 * - local requires `model`
 * - cloud `envVars` keys must not start with `THEOKIT_`
 * - cloud stdio MCP must not pass `cwd`
 * - subagent inline definitions require `description` and `prompt`
 * - programmatic `hooks` are rejected (hooks are file-based only)
 * - memory `storePath`, when relative, must stay inside the workspace
 *
 * @internal
 */
export function validateAgentOptions(options: AgentOptions): void {
  rejectProgrammaticHooks(options);
  ensureRuntimeShape(options);
  if (options.local !== undefined) {
    if (options.model === undefined) {
      throw new ConfigurationError("Local agents require a model selection", {
        code: "missing_model",
      });
    }
  }
  if (options.cloud !== undefined) {
    validateCloud(options.cloud);
  }
  validateMcpServers(options);
  validateSubagents(options.agents);
  validateMemory(options);
}

function ensureRuntimeShape(options: AgentOptions): void {
  if (options.local !== undefined && options.cloud !== undefined) {
    throw new ConfigurationError(
      "Pass either local or cloud — they are mutually exclusive runtimes",
      { code: "runtime_exclusive" },
    );
  }
}

function rejectProgrammaticHooks(options: AgentOptions): void {
  if ((options as { hooks?: unknown }).hooks !== undefined) {
    throw new ConfigurationError(
      "Programmatic hooks are not supported — hooks are file-based only (.theokit/hooks.json)",
      { code: "programmatic_hooks_rejected" },
    );
  }
}

function validateCloud(cloud: CloudOptions): void {
  if (cloud.envVars !== undefined) {
    for (const key of Object.keys(cloud.envVars)) {
      if (key.startsWith("THEOKIT_")) {
        throw new ConfigurationError(
          `Cloud envVars cannot use the reserved THEOKIT_ prefix (got "${key}")`,
          { code: "reserved_env_prefix" },
        );
      }
    }
  }
}

function validateMcpServers(options: AgentOptions): void {
  if (options.mcpServers === undefined) return;
  for (const [name, config] of Object.entries(options.mcpServers)) {
    if (options.cloud !== undefined && isStdioWithCwd(config)) {
      throw new ConfigurationError(
        `MCP server "${name}" uses stdio with cwd, which is rejected for cloud agents`,
        { code: "cloud_stdio_cwd_rejected" },
      );
    }
  }
}

function isStdioWithCwd(config: McpServerConfig): boolean {
  const stdio = config as { type?: string; cwd?: string };
  if (stdio.type !== "stdio" && stdio.type !== undefined) return false;
  if ("command" in config && typeof stdio.cwd === "string" && stdio.cwd.length > 0) {
    return true;
  }
  return false;
}

function validateSubagents(
  agents: Record<string, AgentDefinition> | undefined,
): void {
  if (agents === undefined) return;
  for (const [name, definition] of Object.entries(agents)) {
    if (typeof definition.description !== "string" || definition.description.length === 0) {
      throw new ConfigurationError(
        `Subagent "${name}" requires a non-empty description`,
        { code: "subagent_missing_description" },
      );
    }
    if (typeof definition.prompt !== "string" || definition.prompt.length === 0) {
      throw new ConfigurationError(`Subagent "${name}" requires a non-empty prompt`, {
        code: "subagent_missing_prompt",
      });
    }
  }
}

function validateMemory(options: AgentOptions): void {
  const memory = (options as { memory?: { storePath?: string } }).memory;
  if (memory?.storePath === undefined) return;
  const storePath = memory.storePath;
  if (storePath.includes("..") || storePath.startsWith("/") || /^[A-Z]:/i.test(storePath)) {
    throw new ConfigurationError(
      `Memory storePath must stay inside the workspace; got "${storePath}"`,
      { code: "memory_path_traversal" },
    );
  }
}

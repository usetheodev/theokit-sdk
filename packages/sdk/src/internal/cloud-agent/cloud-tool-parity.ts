import { ConfigurationError } from "../../errors.js";
import type { AgentOptions } from "../../types/agent.js";
import type { McpServerConfig } from "../../types/mcp.js";

/**
 * Cloud tool parity validator (ADR D15 + D16).
 *
 * When `cloud:` is set on `AgentOptions`, this validator rejects
 * configurations that can't survive the trip to TheoCloud. The goal: no
 * silent-drop. Either the feature serializes to JSON for PaaS (passes here)
 * or it's local-only and the caller hears about it immediately at
 * `Agent.create()` time, not at runtime.
 *
 * Coordinates with the existing checks in `validateAgentOptions`:
 *   - `programmatic_hooks_rejected` — universal (covers EC-4 hook closures).
 *   - `cloud_stdio_cwd_rejected` — cloud + stdio with cwd.
 *   - `runtime_exclusive` — local + cloud both set.
 *
 * (`cloud_plugin_path_rejected` used to be listed here too. Removed — B-107, 2026-08-19 — the
 * `plugins.paths` guard it backed defended a config no caller could express; see
 * `validate-agent-options.ts` and `plugins-manager.ts` for the decision record.)
 *
 * This module adds:
 *   - `cloud_incompatible_mcp_stdio_local` — stdio command on a local FS path
 *     (`/`, `~/`, `./`, `../`). Bare commands like `npx`/`uvx`/`node`
 *     accepted (EC-3 fix: blacklist over whitelist).
 *   - `cloud_incompatible_function_resolver` — `systemPrompt` as a
 *     `SystemPromptResolver` function (must be a serializable string for
 *     cloud).
 *
 * @internal
 */

export function validateCloudToolParity(options: AgentOptions): void {
  if (options.cloud === undefined) return;
  rejectFunctionSystemPrompt(options);
  rejectFunctionSkills(options);
  rejectProcessors(options);
  rejectStdioMcpLocalPaths(options);
}

function rejectProcessors(options: AgentOptions): void {
  const hasProcessors =
    (options.inputProcessors?.length ?? 0) > 0 || (options.outputProcessors?.length ?? 0) > 0;
  if (hasProcessors) {
    throw new ConfigurationError(
      "Cloud agents can't run guardrail processors — a Processor carries function handlers that don't survive serialization to PaaS. Run processors on a local agent, or move the guardrail into a server-side gateway in front of TheoCloud.",
      { code: "cloud_incompatible_function_resolver" },
    );
  }
}

function rejectFunctionSystemPrompt(options: AgentOptions): void {
  if (typeof options.systemPrompt === "function") {
    throw new ConfigurationError(
      "Cloud agents require systemPrompt as a serializable string. SystemPromptResolver functions can't run on PaaS — resolve to a string before Agent.create() or move the dynamic logic into a hook rule.",
      { code: "cloud_incompatible_function_resolver" },
    );
  }
}

function rejectFunctionSkills(options: AgentOptions): void {
  if (typeof options.skills === "function") {
    throw new ConfigurationError(
      "Cloud agents require skills as a static settings object. SkillsResolver functions can't run on PaaS — resolve to a SkillsSettings object before Agent.create() or move the dynamic logic into a hook rule.",
      { code: "cloud_incompatible_function_resolver" },
    );
  }
}

function rejectStdioMcpLocalPaths(options: AgentOptions): void {
  if (options.mcpServers === undefined) return;
  for (const [name, config] of Object.entries(options.mcpServers)) {
    if (!isStdioCommandConfig(config)) continue;
    const command = (config as { command?: string }).command ?? "";
    if (isLocalPath(command)) {
      throw new ConfigurationError(
        `MCP server "${name}" uses a local-FS command path (${command}). Cloud agents can't reach local binaries — use a bare command (npx, uvx, node, …) that the PaaS VM image provides, or switch to an HTTP MCP server.`,
        { code: "cloud_incompatible_mcp_stdio_local" },
      );
    }
  }
}

function isStdioCommandConfig(config: McpServerConfig): boolean {
  const obj = config as { type?: string; command?: unknown };
  if (obj.type !== undefined && obj.type !== "stdio") return false;
  return typeof obj.command === "string" && obj.command.length > 0;
}

/**
 * Local-FS path heuristic (EC-3). Conservative: reject only patterns that
 * are unambiguously paths on the caller's disk. Bare commands (no path
 * separator at the start) are assumed to be available in the VM's PATH.
 *
 * @internal
 */
export function isLocalPath(command: string): boolean {
  return (
    command.startsWith("/") ||
    command.startsWith("~/") ||
    command.startsWith("./") ||
    command.startsWith("../")
  );
}

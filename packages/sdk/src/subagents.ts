/**
 * `@theokit/sdk/subagents` — sub-agent tool scoping (M4-6).
 *
 * `subagentToolWhitelist(definition)` derives a `Set` of allowed tool names
 * from an `AgentDefinition.tools` whitelist (or `undefined` when unscoped).
 * `withSubagentToolScope(definition, fn)` runs `fn` under that whitelist via
 * the SDK's existing `withToolWhitelist` enforcement (the same dispatch veto
 * forks use) — so a `tools: ["read_file"]` sub-agent provably cannot call
 * `write_file`/`shell_exec`. NOT `PermissionEngine`.
 *
 * Lives on a dedicated sub-export (not the main barrel) because it reaches into
 * `internal/runtime` — same isolation pattern as `@theokit/sdk/path-safety`.
 */

export {
  subagentToolWhitelist,
  withSubagentToolScope,
} from "./internal/runtime/skills/subagent-tool-scope.js";

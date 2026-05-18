import type { SDKMessage } from "../../types/messages.js";
import type { RunResult } from "../../types/run.js";
import { redactSecrets } from "../security/index.js";
import {
  buildCloudScript,
  contextAwareScript,
  defaultFinishedScript,
  errorRunScript,
  isMemoryRecallPrompt,
  isMemoryWritePrompt,
  listMcpToolsScript,
  memoryRecallScript,
  memoryWriteScript,
  printEnvScript,
  providerFallbackScript,
  returnAnswerScript,
  returnOnlyScript,
  shellExplainScript,
  shellWithApprovalScript,
  slowRunScript,
  spawnSubagentsScript,
  twoShellCommandsScript,
  useSkillScript,
  webSearchScript,
} from "./fixture-scripts.js";
import type { FixtureRequest, FixtureScript } from "./fixture-types.js";

/**
 * Fixture responder entry point. Pattern-matches the user message against a
 * dispatch table, builds the script via the appropriate builder, then
 * redacts any provider-token-shaped substrings before returning.
 *
 * @internal
 */

export type { FixtureRequest, FixtureScript } from "./fixture-types.js";

type ScriptHandler = (request: FixtureRequest) => FixtureScript;

const LOCAL_SCRIPT_RULES: ReadonlyArray<{
  match: (m: string, request: FixtureRequest) => boolean;
  build: ScriptHandler;
}> = [
  { match: (m, r) => isMemoryRecallPrompt(m, r), build: memoryRecallScript },
  { match: (m) => isMemoryWritePrompt(m), build: memoryWriteScript },
  { match: (m) => m.includes("Run npm run slow"), build: slowRunScript },
  {
    match: (m) => m.includes("Run npm run fail") || m.includes("failing-tool"),
    build: errorRunScript,
  },
  { match: (m) => m.includes("Return only:"), build: returnOnlyScript },
  {
    match: (m) =>
      m.includes("ask for approval before editing") ||
      m.includes("Use shell to inspect src/index.js, then answer"),
    build: shellWithApprovalScript,
  },
  { match: (m) => m.includes("Run two shell commands"), build: twoShellCommandsScript },
  { match: (m) => m.includes("Run ls and explain"), build: shellExplainScript },
  {
    match: (m) => m.includes("exported answer") || m.includes("report the exported answer"),
    build: (r) => returnAnswerScript(r, "The answer is 42."),
  },
  { match: (m) => m.includes("Spawn reviewer and worker subagents"), build: spawnSubagentsScript },
  {
    match: (m) =>
      m.includes("List available MCP tools") ||
      m.includes("Which MCP servers are active") ||
      m.includes("List MCP tools after resume"),
    build: listMcpToolsScript,
  },
  {
    match: (m) => m.includes("Search docs for SDK contract testing patterns"),
    build: webSearchScript,
  },
  { match: (m) => m.includes("Use provider fallback"), build: providerFallbackScript },
  { match: (m) => m.includes("Print env and then summarize"), build: printEnvScript },
  {
    match: (m) => m.includes("Use the code-review skill"),
    build: (r) => useSkillScript(r, "code-review"),
  },
  { match: (m) => m.includes("Answer using loaded project context"), build: contextAwareScript },
];

/**
 * Dispatch the user message to a deterministic fixture response.
 *
 * @internal
 */
export function buildFixtureScript(request: FixtureRequest): FixtureScript {
  const script =
    request.runtime === "cloud" ? buildCloudScript(request) : buildLocalScript(request);
  return redactScriptSecrets(script);
}

function buildLocalScript(request: FixtureRequest): FixtureScript {
  const m = request.userMessage;
  for (const rule of LOCAL_SCRIPT_RULES) {
    if (rule.match(m, request)) return rule.build(request);
  }
  return defaultFinishedScript(request);
}

// ─────────────────────────────────────────────────────────────────────────────
// Secret redaction — strips obvious provider tokens + fixture sentinel
// from event payloads. Canonical patterns come from `internal/security`;
// the `fixture-search-secret` sentinel is local because:
//   - EC-2 fix: registering it via `Security.addPattern` would be cleared
//     by `_resetForTests({ clearExtras: true })` between tests (the module
//     init only runs once per worker).
//   - The sentinel is specific to fixture mode and shouldn't pollute the
//     global redaction surface that other consumers see.
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE_SENTINEL = /fixture-search-secret/g;

function redactScriptSecrets(script: FixtureScript): FixtureScript {
  const events = script.events.map(redactEventSecrets);
  return { ...script, events };
}

function redactEventSecrets(event: SDKMessage): SDKMessage {
  const serialized = JSON.stringify(event);
  // Step 1: local fixture sentinel — scoped to this module only.
  const localStripped = serialized.replace(FIXTURE_SENTINEL, "***");
  // Step 2: canonical redaction (12 builtin patterns + PARAM + user extras).
  const redacted = redactSecrets(localStripped);
  if (redacted === serialized) return event;
  return JSON.parse(redacted) as SDKMessage;
}

/**
 * Extract a Run-level extras object (e.g. fallback provider info) when the
 * script declared one. Used by the Run impl to merge into RunResult.
 *
 * @internal
 */
export function applyExtraRunFields(base: RunResult, script: FixtureScript): RunResult {
  if (script.extraRunFields === undefined) return base;
  return { ...base, ...script.extraRunFields } as RunResult;
}

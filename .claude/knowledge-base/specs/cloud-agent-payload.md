# Cloud Agent Payload Spec (v1.0)

> **Audience:** TheoCloud implementation team.
> **Status:** Locked. Plan: [`cloud-tool-parity-plan.md`](../plans/cloud-tool-parity-plan.md). ADRs: D15, D16.
> **SDK source of truth:** `packages/sdk/src/internal/runtime/cloud-payload-types.ts` + `cloud-config-serializer.ts`.

## Purpose

When a consumer calls `Agent.create({ cloud: ..., ...config })` in the SDK, the validator (ADR D15/D16) rejects cloud-incompatible inline configurations and the serializer produces a canonical JSON document — the **cloud agent payload**. This document is what TheoCloud receives at `POST /v1/agents/{id}/runs` as the `agentConfig` field of the request body.

PaaS reconstructs the agent's tool catalog from this payload + the cloned repo's `.theokit/` directory.

## Payload TypeScript interface

```ts
interface CloudAgentPayload {
  schemaVersion: "1.0";
  cloud: {
    repos: Array<{ url: string; startingRef?: string }>;
    autoCreatePR?: boolean;
  };
  agentId?: string;
  model?: { id: string };
  systemPrompt?: string;
  skills?: { enabled: ReadonlyArray<string> };
  plugins?: { enabled: ReadonlyArray<string> };
  hooks?: ReadonlyArray<HookRule>;
  mcpServers?: Record<string, McpHttpRedacted | McpStdioRedacted>;
  agents?: Record<string, SubagentRef>;
  providers?: { routes?: ReadonlyArray<{ provider: string; model?: string }>; fallback?: ReadonlyArray<string> };
  memory?: {
    enabled: boolean;
    index?: { backend: "sqlite-vec"; embedding?: { provider: string; model?: string } };
  };
}

interface HookRule {
  event: string;
  command?: string;
  reject?: string;
}

interface McpHttpRedacted { type: "http"; url: string; }
interface McpStdioRedacted { type: "stdio"; command: string; args?: ReadonlyArray<string>; }

interface SubagentRef {
  description?: string;
  systemPrompt?: string;
  model?: { id: string };
}
```

## Canonical JSON guarantees

- **Object keys sorted alphabetically (recursive).** SDK uses `canonicalize()` so two callers with the same conceptual config produce byte-identical JSON regardless of how they constructed the options object. This guarantees stable hashes for caching.
- **`undefined` fields are dropped entirely** — no `"name": null`, no `"skills": null`.
- **Empty arrays are omitted** — no `"skills": { "enabled": [] }`.
- **`schemaVersion: "1.0"` is required and locked.** v2 work is a separate ADR.
- **Size:** the SDK emits a `stderr` warning when payload exceeds 1 MB but does not throw. PaaS should publish its own hard limit + reject above that with a clear error.

## Secrets redaction (ADR D16 EC-2)

The SDK serializer NEVER forwards the following fields, even if present in `AgentOptions`:

| Source field | Stripped because |
|---|---|
| `apiKey` (top-level or any nested) | API key crosses in `Authorization: Bearer ...` header, never payload body. |
| `mcpServers.<n>.headers` (entire object) | Caller-side credentials. PaaS configures its own MCP creds via keystore. |
| `mcpServers.<n>.env` (entire object) | Same as headers. |
| `providers.routes[i].apiKey` / `clientSecret` | Per-route credentials live in PaaS keystore. |
| `memory.index.embedding.apiKey` | Embedding provider creds live in PaaS keystore. |

PaaS implementations: assume the payload contains NO credentials. Inject them server-side from your keystore.

## Validation rejected at SDK create-time (ADR D16)

These configurations NEVER reach PaaS because the SDK rejects them at `Agent.create()`:

| Code | Rejects |
|---|---|
| `cloud_incompatible_function_resolver` | `systemPrompt` declared as a function instead of a string. |
| `cloud_incompatible_mcp_stdio_local` | `mcpServers.<n>.command` starting with `/`, `~/`, `./`, or `../`. Bare commands (`npx`, `uvx`, `node`, `python`, `pnpm`, etc.) are accepted on the assumption that the VM image provides them in PATH. |
| `programmatic_hooks_rejected` | `hooks` declared as a function (universal SDK validation, applies to local + cloud). |
| `cloud_plugin_path_rejected` | `plugins.paths` referring to a local-FS path. |
| `cloud_stdio_cwd_rejected` | `mcpServers.<n>` stdio with a `cwd` field set. |
| `runtime_exclusive` | `local: {}` AND `cloud: {}` both set on the same options. |

## VM image PATH commitment

PaaS guarantees the following commands are in `$PATH` of every VM that runs a cloud agent. SDK consumers can declare stdio MCP servers using these bare commands without rejection:

- `node` (>=22.12)
- `npx`
- `pnpm`
- `python` / `python3` (>=3.10)
- `uvx`
- `pipx`
- `deno`
- `bun`

Additions require a coordinated update of this spec + the corresponding SDK ADR.

## Golden fixtures

The SDK ships canonical example payloads under `packages/sdk/tests/golden/agent/cloud-payload/`. Each fixture is a real JSON output of `serializeCloudAgentConfig` for a documented config. PaaS implementations should grep this directory for ground truth on the shape.

Reference examples in the SDK repo:

- `examples/cloud-with-skills/` — payload with `skills.enabled` populated.
- `examples/cloud-with-mcp-http/` — payload with both HTTP and bare-stdio MCP servers.
- `examples/cloud-with-subagents/` — payload with `agents` map.
- `examples/cloud-agent/` — minimal payload with `cloud.autoCreatePR`.

## Versioning policy

- **Adding optional fields** to the payload is forward-compatible. SDK v1.0.x can introduce new fields; PaaS v1 will receive but may ignore them.
- **Renaming or removing fields** requires a `schemaVersion` bump to `"2.0"` + coordinated SDK + PaaS release.
- **Tightening validation** (rejecting configs that previously passed) is a minor version bump in the SDK and is documented as a BREAKING change in `CHANGELOG.md`.

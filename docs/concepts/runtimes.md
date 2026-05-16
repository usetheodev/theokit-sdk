# Runtimes — local and cloud

`@usetheo/sdk` wraps two runtimes behind one interface. Your code is the same regardless of where the agent runs.

| Runtime | What runs the agent | When to use |
| --- | --- | --- |
| **Local** | Inline in your Node process. Files come from disk. | Dev scripts, CI checks against a working tree, anything where the SDK caller already has the repo cloned. |
| **Cloud (Theo-hosted)** | Isolated VM with your repo cloned in. *Pre-release.* | When the caller does NOT have the repo, you want many agents in parallel, or runs must survive caller disconnects. |
| **Cloud (self-hosted)** | Same shape, but you run the VM pool. *Pre-release.* | Compliance, air-gapped environments, code that must stay in your network. |

## Picking the runtime

The runtime is picked by which key you pass to `Agent.create()`:

```typescript
// Local
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-exp:free" },
  local: { cwd: "/path/to/repo" },
});

// Cloud
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-exp:free" },
  cloud: {
    repos: [{ url: "https://github.com/your-org/your-repo", startingRef: "main" }],
    autoCreatePR: true,
  },
});
```

Both use the same `THEOKIT_API_KEY`. Pass exactly one of `local` or `cloud`.

## Runtime detection on resume / list / get

When operating on an existing agent by ID, runtime is auto-detected from the ID prefix:

- `agent-<uuid>` → local
- `bc-<uuid>` → cloud

This drives `Agent.resume()`, `Agent.get()`, `Agent.getRun()`, `Agent.archive()`, etc. — no need to pass `{ runtime: "cloud" }` explicitly.

For `Agent.list()` you may filter explicitly:

```typescript
const local = await Agent.list({ runtime: "local", cwd: process.cwd() });
const cloud = await Agent.list({ runtime: "cloud" });
```

## Capability differences

| Capability | Local | Cloud |
| --- | --- | --- |
| `listArtifacts()` / `downloadArtifact()` | empty / throws | works |
| `cloud.envVars` (short-lived secrets) | n/a | yes |
| `autoCreatePR`, `workOnCurrentBranch` | n/a | yes |
| `git` metadata on `RunResult` | n/a | populated |
| `local.settingSources` (file-based config layers) | yes | n/a — cloud always loads project/team/plugins |
| `local.force` (expire stuck run) | yes | cloud returns `409 agent_busy` instead |
| File-based MCP from `.theokit/mcp.json` | via `settingSources: ["project"]` | always loaded from committed `.theokit/mcp.json` |
| Cron jobs survive caller exit | no | yes |

## Pre-release notice

The cloud runtime requires **Theo PaaS**, currently pre-release. The contract documented here is stable; the deploy target is not yet at general availability.

Local runtime works without Theo PaaS. Use it freely.

## Next

- [Stream events](./stream-events.md) — what `run.stream()` yields
- [Cron jobs](../guides/cron-jobs.md) — runtime is inferred from how the job is created

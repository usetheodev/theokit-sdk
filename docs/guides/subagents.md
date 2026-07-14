# Subagents

Named subagents are spawned by the parent agent via its `Agent` tool. Useful for splitting concerns ("the parent plans, the subagent reviews", "writer + tester", etc.).

## Inline definitions

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
  agents: {
    "code-reviewer": {
      description: "Expert code reviewer for quality and security.",
      prompt: "Review code for bugs, security issues, and proven approaches.",
      model: "inherit",
    },
    "test-writer": {
      description: "Writes tests for code changes.",
      prompt: "Write comprehensive tests for the given code.",
    },
  },
});
```

| Field | Purpose |
| --- | --- |
| `description` | Shown to the parent agent so it knows when to spawn this subagent. Required. |
| `prompt` | System prompt for the subagent. Required. |
| `model` | Override the parent's model selection. Pass `"inherit"` to use whatever the parent is using. Defaults to `"inherit"`. |
| `mcpServers` | MCP servers available to the subagent. Names reference servers from the parent's `mcpServers`. |

## File-based definitions

Subagents committed to the repo at `.theokit/agents/*.md` are picked up automatically when `local.settingSources` includes `"project"`. Format:

```markdown
---
name: code-reviewer
description: Expert code reviewer for quality and security.
model: inherit
---

Review code for bugs, security issues, and proven approaches.
```

The body of the markdown file is the prompt. Frontmatter carries `name`, `description`, and optional `model`.

## Precedence

Inline definitions in `Agent.create()` override file-based ones with the same name.

## Programmatic delegation with `SubAgent.create` (lifecycle hooks)

The declarative `agents` map above is the common path. For programmatic control — governing *when* a delegation runs, *what* prompt it gets, *how far* it may iterate, and *what* comes back — build the delegation tool yourself with `SubAgent.create` from the `@theokit/sdk/a2a` sub-path and pass it in `tools`:

```typescript
import { SubAgent } from "@theokit/sdk/a2a";

const reviewer = SubAgent.create({
  name: "reviewer",
  description: "Reviews a diff for bugs.",
  instructions: "Review the given code for bugs and security issues.",
  // model?, tools?, maxDelegationDepth? also supported
});

const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  tools: [reviewer],
});
```

The child inherits the parent's credentials, model (unless the spec overrides it), and plugins (so the child's inner tool calls run under the **same** permission gate). The spec accepts these optional hooks:

### `onDelegationStart` — gate / rewrite before the child runs

Runs before the supervisor delegates. Return `{ proceed: false, rejectionReason }` to **reject** (the child never runs; `rejectionReason` becomes the tool result), or `{ modifiedInput }` to rewrite the delegated prompt. Returning nothing (or `{ proceed: true }`) proceeds unchanged.

```typescript
SubAgent.create({
  name: "reviewer",
  description: "Reviews a diff.",
  instructions: "Review this code.",
  onDelegationStart: (ctx) => {
    // ctx: { input, name, iteration }
    if (ctx.iteration > 3) return { proceed: false, rejectionReason: "review budget exhausted" };
    if (ctx.input.length > 10_000) return { modifiedInput: ctx.input.slice(0, 10_000) };
    // return { modifiedMaxSteps: 4 } to cap the child's iteration count
  },
});
```

| Context field | Meaning |
| --- | --- |
| `input` | The prompt about to be delegated. |
| `name` | The subagent's name. |
| `iteration` | 1-based count of times **this** subagent tool has been invoked (a per-instance counter). Incremented before the hook runs; a rejected delegation still counts — enables reject-after-N loop guards. |

| Decision field | Effect |
| --- | --- |
| `proceed: false` + `rejectionReason?` | Reject: the child never runs; `rejectionReason` is returned as the tool result. |
| `modifiedInput?` | Rewrites the prompt sent to the child. |
| `modifiedMaxSteps?` | Caps the child's iteration count (forwarded as `SendOptions.maxIterations`). |

### `onDelegationComplete` — inspect / annotate after the child settles

Runs after the delegation settles. On success `ctx.result` is set and an optional `{ feedback }` is appended to it. On failure `ctx.error` is set and the original error is **always** re-thrown after the hook runs.

```typescript
onDelegationComplete: (ctx) => {
  // ctx: { input, name, iteration, result?, error? }
  if (ctx.result !== undefined) return { feedback: "\n[reviewed by supervisor]" };
},
```

### `messageFilter` — opt-in parent-context forwarding (isolation is the default)

By default the child runs **input-only** — the supervisor transcript is never forwarded (memory isolation is the default). Set `messageFilter` to forward a **subset** of the supervisor transcript to the child as a role-tagged context preamble. The filter is the *only* path that widens the child's context — a filter returning `[]` forwards nothing.

```typescript
messageFilter: ({ messages, input, name }) =>
  // forward only non-confidential messages
  messages.filter((m) => !m.content.includes("[confidential]")),
```

### `includeToolResults` — return the child's tool results to the supervisor

By default the delegation returns the child's final **text only**. Set `includeToolResults: true` to also append the child's completed tool-call results (name + result) inside a `<subagent-tool-results>` block. See [ADR 0006](../adr/0006-subagent-tool-results-passthrough.md).

> **Fail-fast contract.** Every hook is fail-loud: a throwing `onDelegationStart` / `messageFilter` / success-path `onDelegationComplete` surfaces as a tool error and is never silently swallowed (Unbreakable Rule 8). The one exception is a throw from `onDelegationComplete` on the *error* path — it is suppressed so it cannot mask the delegation's real failure.

### Cancellation

Pass an `AbortSignal` through the run (`agent.send(input, { signal })`) and it is forwarded to any in-flight child; aborting it cancels the child (which resolves `cancelled`, not `finished`). The child agent is disposed in a `finally` even on cancel or error — no leak.

## MCP scoping

A subagent can subscribe to a subset of the parent's MCP servers by listing names in `mcpServers`:

```typescript
agents: {
  "doc-writer": {
    description: "Writes documentation from code.",
    prompt: "Read code, write docs in our style.",
    mcpServers: ["docs"],            // only the "docs" MCP server
  },
}
```

This keeps the subagent's tool surface narrow and intentional.

## Next

- [MCP servers](./mcp-servers.md) — defining the servers subagents reference
- [Hooks](./hooks.md) — file-based policy that also applies to subagents

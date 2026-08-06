---
type: API Guide
title: Permissions
description: First matching rule wins, unmatched means ask, explicit deny is immune to mode — a deterministic authorization layer evaluated without an LLM.
tags: [security, permissions, fail-closed, testing]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 7.3, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 7.3 — permissions
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: types
    resource: packages/sdk/src/types/ (PermissionEngine, PermissionPlugin)
    title: Permission surface — verified at @theokit/sdk@4.36.0 on 2026-07-30
---

# The engine

```typescript
import { PermissionEngine } from "@theokit/sdk";

const engine = new PermissionEngine([
  { tool: "delete_file", action: "deny" },
  { tool: /^read_/, action: "allow" },
]);

engine.evaluate("delete_file");                      // "deny"
engine.evaluate("read_file");                        // "allow"
engine.evaluate("send_email");                       // "ask"  ← fail-closed
engine.evaluate("write_file", undefined, "plan");    // "deny" (plan mode is read-only)
engine.evaluate("delete_file", undefined, "bypass"); // "deny" — explicit deny is immune to mode
```

Modes: `default` (rules decide; unmatched ⇒ `ask`), `plan` (read-only), `acceptEdits`,
`bypass` / `bypassPermissions`.

# Three design properties worth copying

1. **Fail-closed by omission** — what was not anticipated asks for confirmation; it does not
   pass. The same invariant appears in
   [limits and budgets](/sdk/limits-and-budgets.md) (a throwing budget gate denies) and in
   [human in the loop](/concepts/human-in-the-loop.md) (a timeout denies).
2. **Explicit `deny` is immune to mode** — no convenience flag runs over a deliberate denial.
3. **Mode is a layer, not a substitute** — `plan` restricts; it never relaxes a rule.

# It is evaluated without an LLM

This is the property that makes the layer trustworthy: the engine is deterministic and
unit-testable in milliseconds. Zero API key, zero network, zero variance.

A proper suite has at least a dozen cases and covers the negative and boundary ones, not just
the happy path: empty rule list, `deny` under `bypass`, unmatched under each mode, regex
overlap ordering. That is the broad base of the pyramid described in
[evaluation](/operations/evaluation.md) § the test pyramid applied to agents.

> **Security that depends on the model obeying is theater.** Enforcement lives in the
> dispatch — see [attack surface](/concepts/attack-surface.md).

# Resolving an `ask`

The engine decides `allow` / `deny` / `ask`. Resolving an `ask` is the job of a
`PermissionPlugin` with a `canUseTool` gate, and that is where a human enters the loop:

```typescript
const gate = PermissionPlugin.create(engine, {
  mode: "default",
  canUseTool: async (toolName, input, ctx) => { /* ... */ },
});
```

The complete pattern — including what the approval screen must show, and why a `deny` message
must carry a reason — is [human in the loop](/concepts/human-in-the-loop.md).

Two consequences that surprise people:

* A `deny` **does not end the run.** Its `message` becomes the model's next observation, so
  the agent can explain the refusal instead of retrying it. A silent deny buys a
  [doom loop](/concepts/doom-loop.md).
* A denial is observable out of band as `RunEvent` `permission_denied` — the audit channel,
  not the content channel. See [observation channels](/sdk/observation-channels.md).

# Scope beyond a single agent

Subagent tool scope is enforced by the same philosophy but a different primitive —
`withSubagentToolScope`, see [squad and subagents](/sdk/squad-and-subagents.md). Per-send
narrowing is `activeTools`, see [tools and ACI](/sdk/tools-and-aci.md). All three are dispatch
enforcement; none is a prompt request.[^course]

[^course]: Agent AI course, Module 7.3

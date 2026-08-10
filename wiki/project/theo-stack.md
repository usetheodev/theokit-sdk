---
type: Project Context
title: The Theo stack
description: The four pillars, where the Harness sits, what integration actually exists today, and the pre-release honesty rule about the cloud runtime.
tags: [project, positioning, pillars, honesty]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: docs-readme
    resource: docs/README.md, absorbed into this bundle 2026-08-06
    title: The former docs/ navigation page
    author: human:paulohenriquevn
  - id: claudemd
    resource: CLAUDE.md § Relationship to other pillars
    title: Project contract — the pillar split and the no-invented-integration rule
---

# The four pillars

| Pillar | Project | What it does |
| --- | --- | --- |
| UI | `@theokit/ui` | AI-native primitives for agent surfaces (coding-agent + chat) |
| **Harness** | **`@theokit/sdk`** | Agent runtime, local or cloud — **this repository** |
| Skills | `theokit` | Full-stack TypeScript framework |
| Runtime | Theo PaaS | Managed deploy target *(pre-release)* |

The split is locked. `@theokit/sdk` is the harness — not the framework, and not the runtime.

# Integration that actually exists

`CLAUDE.md` states the rule plainly: **do not invent integration that does not exist yet.**
Verify the actual import or dependency before claiming wiring, in copy or in examples.

| Pillar | Integration as of 2026-05-14 | Roadmap |
| --- | --- | --- |
| `@theokit/ui` | none | web chat surfaces may consume its primitives later |
| `theokit` (Skills) | none | an "agent layer" integration lands there |
| Theo PaaS | none (PaaS pre-release) | the cloud runtime endpoint is Theo PaaS |

Capabilities that live in sibling repos are listed under *Out-of-repo capabilities* in
[the capability map](/reference/harness-capability-map.md) with a pointer, rather than being
described as if they shipped here.

# Pre-release honesty about cloud

The cloud runtime depends on **Theo PaaS**, currently pre-release. The consequences are
contractual, not stylistic:

* The local runtime is the primary tested path. Every example in this bundle is local.
* Cloud-only features (artifacts, `autoCreatePR`, `envVars`, `git` metadata on results) must be
  labeled as such.
* Local-only features (`local.force`, `local.settingSources`, filesystem hook discovery from
  `cwd`) must be labeled as such.
* No GA promises in copy.

This is also why `Run.supports()` / `unsupportedReason()` exist: local and cloud do not have
the same capability, and the honest response is a queryable contract rather than silent
divergence. See [agent, run and SDKMessage](/sdk/agent-run-sdkmessage.md).

# The naming distinction

The agent itself is "the Theo agent" in prose. The **SDK surface** uses the `Theokit` prefix,
matching the env var (`THEOKIT_API_KEY`) and the package name. Two different things — do not
collapse them.

# The open-stack differentiator

Apache-2.0 SDK, Apache-2.0 local runtime, multi-provider keys, opt-in cloud, walk-away cost
zero. That is the load-bearing claim, and it is the third axis in
[framework comparison](/ecosystem/framework-comparison.md) — runtime ownership.[^claudemd]

[^claudemd]: CLAUDE.md § Relationship to other pillars
[^docs-readme]: The former docs/ navigation page

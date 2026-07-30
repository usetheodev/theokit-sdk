# `@theokit/sdk` documentation

**The code is the documentation.** The exported TypeScript types are the canonical API contract — self-describing (typed, JSDoc'd) — and the runnable [`examples/`](../examples/) show every surface end-to-end.

This folder is intentionally minimal — two reference files plus one teaching track, no prose doc-site to drift out of sync with the code:

- **[Capability map](./harness-capability-map.md)** — every public primitive + its import path, at a glance (the discovery front-door).
- **[Error codes](./error-codes.md)** — the canonical `AgentRunError.code` reference table.
- **[Agent AI course](./course/theokit-agent-ai-course.md)** — a 12-module curriculum (theory + labs) from first agent to Staff-Engineer level, including a framework comparison (LangGraph / LangChain / CrewAI / AutoGen / OpenAI Agents SDK) and a competency rubric. Teaching material, **not** an API contract: where it disagrees with the exported types, the types win.

For contributors, see [`../CONTRIBUTING.md`](../CONTRIBUTING.md) (branch model, PR checklist) and [`../CLAUDE.md`](../CLAUDE.md) (conventions, locked names/toolchain, quality gates).

---

## Where this fits

`@theokit/sdk` is the **Harness** pillar of the [Theo stack](../README.md). The full stack:

| Pillar | Project | What it does |
| --- | --- | --- |
| UI | `@theokit/ui` | AI-native primitives for agent surfaces (coding-agent + chat) |
| **Harness** | **`@theokit/sdk`** | Agent runtime, local or cloud |
| Skills | `theokit` | Full-stack TypeScript framework |
| Runtime | Theo PaaS | Managed deploy target *(pre-release)* |

## License

Apache-2.0 — see [`../LICENSE`](../LICENSE).

# `@theokit/sdk` documentation

The canonical, machine-readable API contract is **[`../docs.md`](../docs.md)** — the source of truth for every public symbol and subpath. Beyond it, **the code is the documentation**: the public API is self-describing (typed, JSDoc'd), and the runnable [`examples/`](../examples/) show every surface end-to-end.

This folder is intentionally minimal — three files, no prose doc-site to drift out of sync with the code:

- **[`../docs.md`](../docs.md)** — full source-of-truth API spec for every public subpath.
- **[Capability map](./harness-capability-map.md)** — every public primitive + its import path, at a glance.
- **[Error codes](./error-codes.md)** — the canonical `AgentRunError.code` reference table.

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

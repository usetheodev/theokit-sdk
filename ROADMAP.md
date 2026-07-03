# @theokit/sdk — Harness Roadmap

> **Part of the [TheoKit Ecosystem Roadmap](../ROADMAP.md).** This file is the authoritative home
> for the **Harness-hardening milestones (M0–M3)** — the 15 cross-validation gaps (#54–#68) filed on
> `usetheo/theokit-sdk`. The cross-pillar integration milestones (M4–M8: Skills↔Harness, UI↔Harness,
> Runtime↔Harness, GA) live in the ecosystem roadmap. Keep the M0–M3 checkboxes in sync between the
> two files.

The `@theokit/sdk` is the **Harness** pillar of Theo. This roadmap tracks the closure of the
edge-case & bottleneck gaps surfaced by the 2026-06/07 cross-validation sweep against 5 SOTA peers
(mastra, opencode, codex, crewAI, adk-js). Master map:
[`.claude/knowledge-base/audits/cross-validation/MASTER-edge-case-bottleneck-map.md`](./.claude/knowledge-base/audits/cross-validation/MASTER-edge-case-bottleneck-map.md).

## How to work these milestones

Each milestone maps to GitHub issues on `usetheo/theokit-sdk`. Per the cycle pipeline:
`/to-plan --milestone M<N>` → `/implement` → `/code-quality` → `/review` → `/release`. Every fix is
**TDD-first** (failing regression test before the fix — Unbreakable Rule 5) and every gap closure
updates `CHANGELOG.md`.

---

### M0 — [x] Harness security floor (3 CRITICALs + live ACP defect)

**Objective:** Nothing is built atop a leaking, injectable Harness.

- [ ] **#56** cross-tenant active-recall cache leak — wire `tenantCtx` into `cache.get/set` (`src/internal/memory/active-memory.ts:131,247`) + two-user isolation test. *(1 crit)*
- [ ] **#54** sandbox `sh -c` injection + full `process.env` leak — arg-vector exec + env allowlist (`src/sandbox/local-sandbox.ts:26`, `src/internal/runtime/lifecycle/spawn-collect.ts:33`). *(1 crit, 8 gaps)*
- [ ] **#59** MCP client timeout (`src/internal/mcp/client.ts:184`). *(1 crit — reconnect deferred to M2)*
- [ ] **#68** ACP permission veto enforced (`packages/acp/src/permission-plugin.ts:115`). *(standalone live defect)*

**Dependencies:** none. **Milestone id for `/to-plan`:** `M0`.

---

### M1 — [x] Harness correctness core (kill silent no-ops)

**Objective:** No surface exists that silently does nothing (`no-stubs-no-mocks-no-wired`).

- [ ] **#58** `AbortSignal`→`dispatchTools` + between-iteration abort + per-tool timeout + JobQueue (`src/internal/agent-loop/tool-dispatch.ts:41`, `loop.ts:73`). *(8 gaps)*
- [ ] **#55** permission fail-**closed** + match beyond name-only. *(4 gaps)*
- [ ] **#65** wire-or-remove the 7/10 dead plugin hooks + `ToolContext` 2nd arg (`src/internal/plugins/types.ts:20`). *(2 gaps)*
- [ ] **#57** prompt-injection/PII scrub on tool results. *(1 gap)*

**Dependencies:** M0. **Milestone id:** `M1`.

---

### M2 — [x] Harness resilience & I/O robustness

- [ ] **#60** 429 backoff (reuse full-jitter helper, `src/internal/llm/pool-aware-client.ts:111`) + circuit breaker. *(3 gaps)*
- [ ] **#61** streaming idle timeout + truncation flag + `{raw}` passthrough. *(7 gaps)*
- [ ] **#59** MCP reconnect-after-drop.
- [ ] **#63** persistence: batch, pagination, atomic turn append. *(4 gaps)*

**Dependencies:** M0, M1. **Milestone id:** `M2`.

---

### M3 — [ ] Harness state & observability

- [ ] **#62** resume no longer lossy + scoped session state (app:/user:/temp:) (`src/internal/.../executor.ts:370`, `agent-session-store.ts:102`). *(5 gaps — public-API change → `docs.md` + Changeset)*
- [ ] **#64** nested spans + metric gap + EventBus stops swallowing handler errors (`src/event-bus.ts:36`). *(5 gaps)*
- [ ] **#66** artifacts scope decision + token-undercount fix. *(2 gaps)*
- [ ] **#67** cross-model cache correctness + session revert. *(3 gaps)*

**Dependencies:** M0, M1. **Milestone id:** `M3`.

---

## Cross-pillar milestones (M4–M8)

Owned by the ecosystem roadmap — the SDK is a **dependency** of those seams, not the driver:

- **M4** Skills↔Harness · **M5** UI↔Harness · **M6** cluster consolidation · **M7** Runtime↔Harness (cloud, pre-release) · **M8** ecosystem GA.

See [`../ROADMAP.md`](../ROADMAP.md) for objectives, DoD, and dependencies.

## References

Study-only peers + full cross-validation reports:
`.claude/knowledge-base/audits/cross-validation/{mastra,opencode,codex,crewai,adk-js}/final_report.md`.

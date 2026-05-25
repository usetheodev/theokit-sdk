# Production-Readiness Plan — Inviolable Invariants

> Cross-cutting rules every Phase 1-6 task MUST respect.
> Cited by every `### Acceptance Criteria` and `### DoD` block in `production-readiness-plan.md`.

## I1 — Zero breaking changes

Every new field/option is **opt-in with safe default**. An app that does not configure any new option keeps working byte-identically.

**Verify:** existing examples (`telegram-pro`, `slack-bot`, `whatsapp-bot`, `email-bot`, `teams-bot`, `vertex-bot`, `bedrock-bot`, `handoffs/`, `workflows/`, `cache/`, `eval/`, `skills-google-workspace/`) compile unmodified and pass typecheck (`tools/typecheck-examples.sh`) at every phase.

## I2 — Real-LLM validation gate

Any code path that calls `agent.send()`, embedding APIs, or active memory is "validated" ONLY when executed against a real LLM with a real API key. Fixture mode (`theo_test_*`) + typecheck alone do NOT count as validation. Per `.claude/rules/real-llm-validation.md`.

## I3 — No stubs / no mocks in production

`packages/sdk/src/**` cannot contain `MockX`, `FakeX`, `StubX`, `throw new Error("not implemented")`, or catalog entries pointing to such. Tests under `packages/sdk/tests/` are exempt. Per `.claude/rules/no-stubs-no-mocks-no-wired.md`.

## I4 — CHANGELOG entry per phase

Every phase that ships shippable code adds an entry under `[Unreleased]` in `packages/sdk/CHANGELOG.md` following Keep a Changelog format (Added / Changed / Fixed / Security categories).

## I5 — `docs.md` section per phase

Every phase that adds public API surface adds a `docs.md` section with code example. `docs.md` is the canonical API contract — drift between code and docs is a bug.

## I6 — Telegram-pro dogfood baseline (44/44 PASS)

Per `.claude/skills/dogfood`. Each phase that touches SDK/runtime MUST end with `examples/telegram-pro` `/dogfood` PASS at ≥ pre-phase count. Regression = block phase commit.

## I7 — Architecture domain diff after final phase

After Phase 7 (dogfood QA), run `/architecture-docs runtime` + `/architecture-docs errors` and diff against the `.claude/knowledge-base/architecture/{runtime,errors}/` baseline created in T0.1. Document deltas. Replace baseline only after user approval.

## I8 — ADR per significant decision

Every consequential decision in the plan (data shape, eviction policy, error semantics, hook lifecycle, signal compose strategy) gets a dedicated ADR file under `.claude/knowledge-base/adrs/D{N}-{kebab-slug}.md`. Plan tracks D303-D325 as base; phases may add more if implementation discovers new decisions.

## I9 — `redactSecrets` invariant preserved (D68)

Storage adapters MUST flow user content through `redactSecrets` before persisting. Phase 1 FS adapter cannot regress this — `appendToSessionFile` already calls redact; FS class delegates to it.

## I10 — `pnpm validate` green at every phase boundary

`pnpm typecheck && pnpm test && pnpm build && pnpm publint && pnpm attw` all green before merging a phase commit.

---

## Quick reference per phase

| Phase | Most-relevant invariants |
|---|---|
| 1 (ConversationStorage) | I1, I3, I9, I10 |
| 2 (Agent.registry) | I1, I6, I10 |
| 3 (AgentRunError) | I1, I4, I5, I10 |
| 4 (AbortSignal) | I1, I2, I6 |
| 5 (Tool hooks) | I1, I2, I6 |
| 6 (Quota hooks) | I1, I2, I10 |
| 7 (Dogfood) | I2, I6, I7 |

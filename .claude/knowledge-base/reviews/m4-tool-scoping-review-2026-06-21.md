# Review — m4-tool-scoping (M4-6)

**Date:** 2026-06-21
**Verdict:** READY_TO_MERGE
**Commits:** f2265d7 (impl) + 1ca4bea (review-hardening)
**Plan:** knowledge-base/plans/m4-tool-scoping-plan.md (plan-confidence SHIPPABLE 97.6)
**Code-quality:** PASS

## Method

Two independent FAANG-level reviewers (read-only), in parallel — architecture/enforcement/honest-scope + tests/wiring/proof-rigor. BOTH returned **READY_TO_MERGE** (0 BLOCKER, 0 HIGH). Both independently VERIFIED the enforcement proof is rigorous + falsifiable (the test breaks on a broken impl — not theater).

## Findings adjudicated

| # | Sev | Source | Finding | Resolution |
|---|---|---|---|---|
| 1 | MEDIUM | B (A: LOW) | No automatic production caller wires `AgentDefinition.tools` → `withSubagentToolScope`; the `.theokit/agents` subagents are surfaced to the parent prompt, and the SDK has no nested-subagent spawn loop to auto-apply the scope. | **Accepted (plan-scoped, not a defect).** Both reviewers: this is M4-6's declared scope (declaration + enforcement bridge + proof, NOT auto-wire into a spawn loop that doesn't exist — YAGNI), honestly documented in the plan's Drawbacks + the `AgentDefinition.tools` docstring + docs.md ("run the sub-agent here e.g. via agent.fork"). The library ships the bridge; the consumer composes it at their root, exactly like `Agent.fork({allowedTools})`. Inventing an auto-wire would be speculative. A future milestone can auto-wrap once a spawn loop lands. |
| 2 | INFO | A,B | EC-3 (nested scope shadow/restore) + EC-4 (exact-case match) documented but not unit-tested at this layer. | **HARDENED** (1ca4bea): added an EC-3 test (nested `withSubagentToolScope` shadows the outer set + restores on return) and an EC-4 test (`Read_File` ≠ canonical `read_file` → real tool vetoed). |
| 3 | INFO | A | the veto reason string says "fork context"/"Tool blocked by fork whitelist" — a sub-agent author sees "fork", not "subagent scope". | Accepted — the reason string lives in the shared `async-local-storage.ts` (used by forks too); parameterizing it risks the shared primitive for a cosmetic diagnostic. Documented that sub-agent scoping reuses the fork mechanism. No churn. |
| 4 | INFO | A,B | proof asserts `checkToolWhitelist` directly rather than via a full agent-loop dispatch. | Accepted — `checkToolWhitelist` IS the literal function the loop's `vetoFromForkWhitelist` (`tool-dispatch.ts:138`) calls; `fork-agent.ts:105` proves the AsyncLocalStorage wrap survives a real run. A faithful, falsifiable proxy. |

## Verdict rationale

Both reviewers confirmed: enforcement is genuine + correct (`withSubagentToolScope` → existing `withToolWhitelist`/`checkToolWhitelist` dispatch veto, the same forks use; NO `PermissionEngine` import — D2); all ADRs delivered (D1 name whitelist, D2, D3 empty/undefined→unscoped, D4 frontmatter parse); the dedicated `@theokit/sdk/subagents` subpath is the architecturally-correct choice (avoids the main-barrel rollup-dts cycle) with no duplicate tsconfig includes; backward-compat preserved (optional `tools?`, cloud serializer allowlist drops it, validation ignores it); typecheck clean. The "no auto-caller" item is M4-6's honestly-framed scope boundary, not a defect — the headline claim ("a read-only sub-agent provably cannot Write/Bash") is true under the bridge, which is exactly the library contract.

## Validation (post-hardening)

- typecheck: clean (0 errors)
- subagent-tool-scope tests: 10 passed (loader parse, whitelist, enforcement proof, passthrough, subpath wiring, EC-3 nesting, EC-4 case)
- full sdk suite: **2819 passed / 35 skipped** (no regression; one prior flaky chaos/partition test passed on re-run)
- biome clean · attw 🌟 (subagents subpath) · code-quality PASS · Coverage Matrix 7/7.

**Verdict:** READY_TO_MERGE

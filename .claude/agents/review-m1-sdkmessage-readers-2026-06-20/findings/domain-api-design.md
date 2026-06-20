# Domain Review — API Design — m1-sdkmessage-readers

Review target: M1-5 `@theokit/sdk/messages` public subpath (`assistantText`, `extractToolUses`, `costAmountUsd`).
Plan: `.claude/knowledge-base/plans/m1-sdkmessage-readers-plan.md`.

Domain-specific patterns checked:
- Naming consistency with existing subpaths (`@theokit/sdk/retry` `withRetry`, `@theokit/sdk/concurrency` `mapWithConcurrency`/`createSemaphore`, `@theokit/sdk/path-safety`).
- Signature ergonomics + type-narrowing.
- Return-type honesty contract (`number | undefined` for cost vs `null` vs `0`) — ADR D377 / D3.
- `docs.md` as source of truth (CLAUDE.md rule): exported names + signatures match code.
- JSDoc accuracy + usefulness on the three exports.
- Zero new dependencies (Unbreakable Rule 9).

## Verdict: API design is SOUND.

The public surface is consistent with the established subpath convention, the signatures are
ergonomic and type-safe, the cost-honesty return contract is correct, `docs.md` is in lockstep
with the code, and zero dependencies were added. No BLOCKER/HIGH/MEDIUM defects found.

---

## [INFO] Naming is consistent with existing subpath conventions
- file: packages/sdk/src/messages.ts:20,37,50
- detail: The three exports are free functions (`assistantText`, `extractToolUses`, `costAmountUsd`), matching the verb/camelCase free-function style of `withRetry` (`retry.ts:10`), `mapWithConcurrency`/`createSemaphore` (`concurrency.ts:13-17`), and the `path-safety` re-exports (`isForbiddenPath`, `safePathJoin`, `assertNoSymlinkEscape`). `extractToolUses` uses the verb-prefixed reader form; `assistantText`/`costAmountUsd` use the noun-accessor form — both forms already coexist in the SDK (`safeFilenameForId`, `sanitizeIdentifier`), so this is within convention. Plan ADR D1 (free functions over a wrapper class) is honored. No action.
- fix: none

## [INFO] Return-type honesty contract for `costAmountUsd` is the correct consumer contract
- file: packages/sdk/src/messages.ts:50-52
- detail: `costAmountUsd(cost: CostBreakdown | undefined): number | undefined` returns `cost?.amountUsd` verbatim, never `?? 0`. This is the right choice over `null`: the source field `CostBreakdown.amountUsd` is already `number | undefined` (`types/usage.ts:56`), so the reader preserves the SDK's own type rather than translating to `null` (which would force consumers to reconcile two absence sentinels). `undefined` = "cost unknown" (`status:"unknown"`), distinct from a real `$0` (`status:"included"` subscription route) — exactly the D377 financial-honesty invariant. Plan ADR D3 + the rejected `null` alternative are both documented. The `number | undefined` signature also forces the caller to handle the unknown case at the type level. Correct.
- fix: none

## [INFO] `docs.md` is the source of truth and is consistent with the code
- file: docs.md:1840-1859
- detail: The "Message readers — `@theokit/sdk/messages`" section documents exactly the three exported names with signatures and behavior matching the implementation: `assistantText` returns `""` for non-assistant (`messages.ts:21-22`), `extractToolUses` returns `ToolUseBlock[]` / `[]` and explicitly distinguishes the assistant content blocks from the separate `SDKToolUseMessage` `type:"tool_call"` lifecycle event (`messages.ts:38-41` + ADR D2), and `costAmountUsd` preserves `number | undefined` never-`$0` (D377). The doc example `costAmountUsd(result.cost)` type-checks against the signature because `RunResult.cost` is `CostBreakdown | undefined` (`types/run.ts:85`). The doc's note that token counts (where `0` is meaningful) are read directly off `TokenUsage` correctly explains why there is no `tokenTotal` reader (YAGNI, plan Unresolved Questions). CLAUDE.md source-of-truth rule satisfied.
- fix: none

## [INFO] JSDoc on all three exports is accurate and useful
- file: packages/sdk/src/messages.ts:14-19,30-36,44-49
- detail: Each export has a focused JSDoc describing the happy path, the empty/absent-case behavior, and the load-bearing distinction. `assistantText` notes `tool_use` blocks are ignored. `extractToolUses` calls out the `SDKToolUseMessage` (`type:"tool_call"`) distinction (the most likely consumer footgun) and cites ADR D2. `costAmountUsd` cites the repo ADR `D377-cost-status-closed-enum.md` and explains `undefined` vs real `$0`. The module header explains lineage (`theocode/server/lib/sdk-mappers.ts`), purity guarantees, and points at `docs.md → Message readers`. Note: the public input types (`SDKMessage`, `ToolUseBlock`, `CostBreakdown`) carry `@public` tags in `types/` but the reader functions do not — this is consistent with the other subpath modules (`retry.ts`/`concurrency.ts` re-exports carry no `@public`), so it is not a divergence. Accurate and useful.
- fix: none

## [INFO] Zero new dependencies (Unbreakable Rule 9)
- file: packages/sdk/package.json:51-60
- detail: The M1-5 wiring commit (`a21949f`) added only the +10-line `"./messages"` exports block; the `dependencies` / `peerDependencies` sections were untouched. `messages.ts` imports only the SDK's own leaf types (`./types/messages.js`, `./types/usage.js`). The `./messages` export block is byte-shape-identical to `./path-safety`, `./concurrency`, `./retry` (dual import/require with `.d.ts`/`.d.cts` mirror). Rule 9 satisfied; subpath convention matched exactly (plan ADR D4).
- fix: none

## [LOW] `extractToolUses` discoverability: name is intent-clear but asymmetric with `assistantText`
- file: packages/sdk/src/messages.ts:20,37
- detail: `assistantText` and `extractToolUses` both operate on an assistant `SDKMessage` but use different naming shapes (noun-accessor vs verb-extract). A consumer scanning autocomplete on `@theokit/sdk/messages` gets `assistantText` / `extractToolUses` / `costAmountUsd` — the grouping is discoverable via the subpath, but the two assistant-content readers do not share a common prefix (e.g. `assistantText` + `assistantToolUses`). This is a minor ergonomic nit, NOT a defect: `extractToolUses` reads naturally, matches the ADK `getFunctionCalls` free-function precedent cited in the plan, and renaming now would churn a just-shipped public name. Flagging only so a future `messages` reader addition (if one ever lands) consciously picks a consistent prefix rather than compounding the asymmetry.
- fix: No change for M1-5. If/when a fourth reader is added, decide a consistent naming axis (verb-prefixed `extract*` vs subject-prefixed `assistant*`) and apply it across the set; do not rename the shipped two without a deprecation cycle.

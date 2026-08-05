# Review: issue-sweep-2026-08

**Date:** 2026-08-05
**Target:** 10 commits on `workspace` since `8beb61da6` (68 files, +2531 / -245)
**Reviewers:** 4 agents in parallel (architecture, tests, wiring, cross-validation)
**Findings:** 34 total — BLOCKER 2, HIGH 7, MEDIUM 11, LOW 8, INFO 6

## Verdict: `NEEDS_FIXES`

Two BLOCKERs. Per `rules/cycle-review.md § Verdicts`, any BLOCKER halts the merge; seven HIGH
independently exceeds the two-HIGH ceiling. Loop back to `/implement`.

## Pre-condition deviations (recorded, not waived)

| Pre-condition | State |
|---|---|
| Plan at `knowledge-base/plans/{slug}-plan.md` | **absent** — issue-driven sweep, not a `/to-plan` cycle. The nine GitHub issues were substituted as ground truth. Plan-vs-implementation line coverage was not computable. |
| `/implement` validation report | **absent** — no halt-loop ran. |
| `/code-quality` audit | **produced during this review** → `PASS_WITH_CAVEATS` (89). D1/D3/D4 did not report; only D2 ran (0 fabrications). Dead-code and orphan-export cleanliness was therefore delegated to the wiring agent, which ran `knip` directly. |
| Tree clean, on `workspace`, tests green | OK (4054 passed / 42 skipped / 0 failed; `turbo typecheck build test` 40/40) |

---

## BLOCKER

### B1 — `ctx.pendingThinking` leaks across turns, attaching a signature to the wrong text
`packages/sdk/src/internal/agent-loop/loop.ts:443` · theokit#122 · found by architecture, verified by orchestrator

`pendingThinking` is produced every round with reasoning (`loop-llm-stream.ts:324`) and consumed in
exactly one place — inside `emitAssistantTextStep` (`loop.ts:202-203`), which is called only when
`text.length > 0`:

```ts
if (text.length > 0) { await emitAssistantTextStep(inputs, ctx, text); }
```

On a **thinking + tool_use round with no preamble text** — the common Anthropic shape — the block is
never consumed and never cleared. Round N's thinking (and its signature) is then folded into round
N+1's assistant record by `applyThinkingStep`. The persisted pair becomes (round N signature, round
N+1 text), which on resume produces precisely the `400 "thinking blocks cannot be modified"` that
theokit#122 exists to eliminate.

No test covers thinking + tool_use + empty text; `thinking-signature-roundtrip.test.ts` only
exercises thinking + text in one turn.

**Action:** clear/flush `pendingThinking` at every round boundary, not only on the text path;
regression test asserting round N's signature never lands on round N+1's record.

### B2 — the in-flight assistant turn is replayed without its thinking block
`packages/sdk/src/internal/agent-loop/message-builders.ts:73` · theokit#122 · found by architecture, verified by orchestrator

```ts
export function buildAssistantTurn(text: string, toolCalls: LlmToolCallPart[]): LlmMessage {
  const content: LlmContentPart[] = [];
  if (text.length > 0) content.push({ type: "text", text });
  for (const call of toolCalls) content.push(call);
  return { role: "assistant", content };
}
```

No `thinking` part is ever produced here, and this is the only builder of the assistant turn pushed
onto `ctx.messages` on the tool_use path (`loop.ts:449`).

This is a defect the same commit **made reachable**: `1e2a5e352` enabled extended thinking on the
Anthropic request (`anthropic-shared.ts:237-243`). A run with `thinking` + tools therefore now asks
for thinking and then sends round 2 with an assistant message whose signed block was dropped.

**Action:** thread the round's thinking part into `buildAssistantTurn` as the first content block;
cover with a two-round test asserting the replayed assistant message begins with a signed block.

---

## HIGH

### H1 — `setDiagnosticsSink` is not exported from any public entry; theokit#147's reported blocker still stands
`packages/sdk/src/index.ts` · found by tests, **verified by orchestrator**

```
setDiagnosticsSink in dist barrel: false
package.json exports map: no "./diagnostics"
```

Every theokit#147 test imports it from `src/internal/diagnostics.js` — a path no consumer can reach.
The suite is green while the issue's actual complaint ("a TUI host has no way to intercept these; no
injectable logger") remains true. The sink is unreachable, so the six bypasses closed by
`ae27def91` improved a channel nobody can install.

**This invalidates a claim published on the issue** (see § Retractions).

**Action:** export `setDiagnosticsSink` / `DiagnosticsSink` from the barrel or a `./diagnostics`
subpath, and add a test that installs the sink **from the public entry** and proves it intercepts a
diagnostic emitted by a real SDK path.

### H2 — the capability-map gate was green before this branch and is red now
`docs/harness-capability-map.md:33-37` · **orchestrator's own finding**

`scripts/check-capability-map.mjs` resolves every documented import at **runtime**
(`await import(spec)` + `n in mod`). This branch added the map's first five *type-only* entries; a
TypeScript type cannot exist at runtime.

```
[sdk] symbols-checked=95 fails=5 FAIL     (was fails=0 at 8beb61da6)
```

**Action:** teach the checker to skip `type`-prefixed names (asserting runtime presence of a type is
a category error), or remove the type entries from the map. Do not leave a committed gate red.

### H3 — `initialize()` idempotence keys on child liveness, not handshake completion
`packages/sdk/src/internal/mcp/client.ts:238` · theokit#155 · found by cross-validation, verified by orchestrator

`spawnChild()` assigns `this.child` (`:198`) **before** `await super.initialize()`, and the override
has no cleanup on throw. A failed handshake therefore leaves a spawned-but-uninitialized client.
Under `'session'`, the run no longer closes it (that is this branch's fix), so turn 2 hits
`if (this.child !== undefined) return` and never retries. **Pre-fix, turn 2 re-spawned and retried.**

A regression introduced by `a15d80f4c` on the failure path. Neither new test exercises a failing
handshake. Recovery *may* still occur via the request timeout marking `dropped` — unconfirmed.

**Action:** guard on an `initialized` flag set only after `super.initialize()` resolves, or clear
`this.child` before rethrowing. Add a test where turn 1's handshake rejects and turn 2 still works.

### H4 — a changeset tells consumers a removal is safe in a direction where it is not
`.changeset/subagent-credentials-scope.md:17` · theokit#148 · found by cross-validation, verified by orchestrator

> "The band-aid symbol-copy in `@theokit/agents` becomes unnecessary, and removing it is safe against
> both old and new SDK versions."

Only (old agents + new SDK) is safe. The reverse — band-aid-free agents on a **pre-#148 SDK** — puts
the old `inheritSubAgentCredentials` symbol lookup against a rebuilt tool object, so the child gets
no key and fails `provider_unresolved`: the exact reported symptom. The skew is a normal install:
`@theokit/agents` declares `"@theokit/sdk": "^4.37.0"` — a caret range, not a pin.

Changesets become the published `packages/sdk/CHANGELOG.md`, so this ships as the permanent record.

**Action:** correct the sentence before release, or raise the SDK floor in `@theokit/agents` in the
same release that removes the loop.

### H5 — three of the four ported embedding adapters cannot work
`packages/sdk-memory/src/internal/embedding/*` · theokit#128 · found by tests, extended and verified by orchestrator

The shared runtime is rigidly OpenAI-shaped: `authorization: Bearer`, body `{ model, input }`,
response must have `json.data[].embedding` (`openai-compatible.ts:269-297`).

| Adapter | Mismatch |
|---|---|
| azure-openai | authenticates via an `api-key` header, not `Bearer`; the deployment is in the path so the body must not carry `model`. The `{model}` fix corrected the URL and left the request malformed. |
| cohere | `/v2/embed` takes `{model, texts, input_type}` and returns `{embeddings:{float:[]}}` — neither direction matches. |
| gemini | the OpenAI-compat surface is at `/v1beta/openai/embeddings`; the adapter uses the default `/v1/embeddings`. |
| jina | matches. |

Pre-existing in core (T4.10) and propagated to the peer by faithful porting. Peer coverage for all
four is metadata-only — no `embed()` is ever called, which is why this survived the sweep.

**Confidence:** the mechanism is verified in-repo (the runtime code is quoted above); the
per-provider wire details are from model knowledge, not a live call. Confirm with a contract test
before acting.

**Action:** add one `embed()` round trip per adapter against a stubbed fetch asserting URL, headers
and body; then fix or withdraw the three that fail.

### H6 — theokit#148's production wiring has no test
`packages/sdk/src/internal/local-agent/real-local-run.ts:522` · found by wiring

The ALS scope **is** correctly wired (traced `createRealLocalRun` → `executeAgentLoop` →
`withInheritedSubAgentCredentials` → `runAgentLoop` → dispatch → subagent handler; all plain awaits).
But both theokit#148 tests open the scope themselves, so **deleting line 522 leaves the suite green**.
This is the third recurrence of this bug class (#142, #143, #148).

**Action:** an integration test that starts from `createRealLocalRun` and asserts the child received
the parent's apiKey **without the test establishing the scope**.

### H7 — the cross-bundle guard for #142/#143 was deleted and its replacement cannot detect the failure
`packages/sdk/tests/a2a/subagent-delegation.test.ts:98` · theokit#148 · found by tests

The old test asserted the sink used a global `Symbol.for` key (cross-bundle safe). It was replaced by
an object-shape assertion (`getOwnPropertySymbols(tool)` is empty) that says nothing about module
duplication — while the new mechanism is a **module-level `AsyncLocalStorage`**, which is itself
duplication-sensitive. Nothing in `tests/` asserts `splitting: true` or exercises the built entries;
all new tests import from `src/`, one module graph, where duplication is invisible.

**Action:** assert `tsup.config.ts` still sets `splitting: true` with a comment citing #142/#143, or
add a dist-level test importing `SubAgent` from `./a2a` and the scope from `.`.

---

## MEDIUM (11)

| # | Finding | File | Issue |
|---|---|---|---|
| M1 | Redaction masks the thinking TEXT while the signature is stored verbatim → mismatched pair → the same 400 on resume | `session-transcript.ts:136` | #122 |
| M2 | `LlmFinish.thinking` is produced and read by nobody — the same declared-but-unwired channel this branch deletes for #144, reintroduced 3 files away | `types.ts:206` | #122 |
| M3 | `Agent.describe()` projects declaration-time options, so disk-discovered subagents (`.theokit/agents/*.md`) and plugin/reasoning tools are absent from what it calls the "live registry" | `agent.ts:571` | #123 |
| M4 | Two literal NUL bytes make `mcp-pool.ts` binary to git — this branch's change to it renders as "Binary files differ" | `mcp-pool.ts:83` | #155 |
| M5 | The `{model}` fix was hand-applied to two duplicated runtimes; the new parity test compares IDs only, so behavioral drift stays unguarded | `openai-compatible.ts` ×2 | #128 |
| M6 | No diagnostic when the credential scope is absent — a fourth recurrence would again surface only as "(no response)" | `subagent.ts:376` | #148 |
| M7 | Orphan export: `InheritedCredentials` re-export has no importer; knip's only repo-wide hit. Its docblock claims "back-compat" for a type that was never public | `subagent.ts:30` | #148 |
| M8 | Peer/core metadata parity is asserted with copied literals rather than a comparison | `embedding-adapter-cluster.test.ts:101` | #128 |
| M9 | theokit#155 suite is happy-path + boundaries only; no negative case despite adjacent typed errors (`mcp_timeout`, `mcp_not_init`) | `session-lifecycle-pid.test.ts` | #155 |
| M10 | The diagnostics changeset asserts every allowlisted writer is a caller-chosen seam; `internal/eval/runner.ts` has two unconditional `console.warn` with no injectable sink | `.changeset/diagnostics-no-bypass.md:14` | #147 |
| M11 | `RealLocalRun` grew two positional params including an unlabelled boolean, both derived from `options.agentOptions` already reachable inside the class | `real-local-run.ts:428` | #155 |

## LOW (8) / INFO (6)

Stale `{@link inheritSubAgentCredentials}`; thinking parts silently dropped by the OpenAI Responses
mapper with no `else`; a near-vacuous `events.every(e => e.type !== "error")` assertion; a golden test
narrowed from deep-equality to a two-field projection; spawned MCP children leaked on assertion
failure (no `try/finally`); the lint gate's `console.*` pattern narrower than its stated scope; two
thin single-call-site extractions flagged against parsimony rung 5; `108679d39` not independently
buildable (fixed by `6dcfec48b`).

INFO confirms: zero madge cycles across 508 modules; the ALS seam does not leak to third-party tool
code and emits a single shared chunk; `tool_use`/`stop` removal is clean; all four memory adapters
are wired into the catalog; both new public statics are barrel-exported and documented.

## Cross-validation summary

All nine issues are delivered against their asks. Three fixes deliberately deviate from the issue's
suggested approach and each states the deviation (#155 adds idempotence; #144 deletes rather than
wires; #148 uses a scope rather than a typed field). All seven falsifiable claims put to the
cross-validation agent were checked against the code and **all seven hold**.

theokit#123 is **partially** delivered: tools + subagents, no workflow enumeration. Correctly not
claimed anywhere. Do not close it outright.

The root `CHANGELOG.md` entries contain no overclaim — the two most at risk (#147 partial, #145
already-released) are the two that caveat themselves. The inaccurate copy is in `.changeset/`
(H4, M10), which is what becomes the published record.

## Retractions required

Three statements I published on the issues are false and must be corrected:

1. **theokit#147** — "a host that wants silence today installs `setDiagnosticsSink(() => {})`: one
   line, already tested." The symbol is not exported; a host cannot import it (H1).
2. **theokit#148** — "removing it is safe in both version-skew directions." False for
   band-aid-free agents on a pre-#148 SDK, which a caret range permits (H4).
3. **theokit#122** — "extended thinking sessions resume." B1 and B2 mean a thinking + tool_use turn
   still corrupts the transcript and still drops the block on replay.

## Handoff

`NEEDS_FIXES` → loop back to `/implement`. Suggested order:

1. B1 + B2 + M1 + M2 together (theokit#122 is one coherent defect; consider reverting `1e2a5e352`
   and redoing it, since the request side is what makes B2 reachable).
2. H1 (export the sink) — smallest change that converts theokit#147 from "fix nobody can use" to
   actually delivered.
3. H3 (handshake guard) — a regression on the failure path, in shipped-critical code.
4. H2, H4, M10 — a red committed gate and two inaccurate published records.
5. H5 — verify with a contract test before deciding fix vs withdraw.
6. H6, H7 — the test gaps that let the recurring credential-loss class survive a third time.

Re-run `/review` after the fixes; do not promote `workspace → develop` before then.

---

## Re-verification — 2026-08-05, after the fixes

The `NEEDS_FIXES` verdict above stands as the record of what the review found. This section records
what happened to each blocking finding, verified mechanically against the tree at `4ef389250`
rather than asserted.

| Finding | Check run | Result |
| --- | --- | --- |
| B1 — `ctx.pendingThinking` leaks across turns | `grep -rn pendingThinking packages/sdk/src` | Closed. The single remaining hit is inside the comment in `loop-llm-stream.ts` that explains why the field was removed — the thinking block is now a per-round value, not context state. |
| B2 — in-flight assistant turn replayed without its thinking block | `tests/internal/session/thinking-signature-roundtrip.test.ts` | Closed. Regression test present; redaction now drops the signature when it invalidates it, rather than shipping a signature that no longer matches its text. |
| H1 — `setDiagnosticsSink` not exported from any public entry | `grep setDiagnosticsSink packages/sdk/src/index.ts` | Closed. Exported from the package barrel. |
| H2 — capability-map gate red on this branch | `node scripts/check-capability-map.mjs` | Closed. PASS. |
| H3 — `initialize()` idempotence keys on child liveness, not handshake | `tests/mcp/initialize-after-failed-handshake.test.ts` | Closed. Regression test present. |
| H4 — changeset claims a removal is safe in the wrong direction | consumed by the 4.39.0 cut | Closed. The changeset was corrected before `version-packages` ran; the published 4.39.0 notes carry the corrected direction. |
| H5 — three of four ported embedding adapters cannot work | `grep EmbeddingDialect internal/memory/adapters/openai-compatible.ts` | Closed. Dialect hooks (`authHeaders` / `body` / `vectors`) shipped; wire-contract tests cover the non-OpenAI shapes. |
| H6 — theokit#148 production wiring has no test | `tests/a2a/subagent-credentials-production-wiring.test.ts` | Closed. Test present. |
| H7 — cross-bundle guard deleted, replacement cannot detect the failure | `node tools/check-cross-cluster.mjs` | Closed. PASS. |

**What this section is NOT.** It is not a re-run of `/review` and does not replace the verdict. No
specialist agents were re-spawned, so findings this pass could not have surfaced — anything
introduced by the fixes themselves — remain unlooked-for. Per `rules/cycle-review.md`, a fresh
`READY_TO_MERGE` requires a fresh review; this is a closure record for the findings the previous one
raised, nothing wider.

**Also honest:** the release these fixes went into (`@theokit/sdk@4.39.0`) shipped before this
section was written. The sequence was fix, publish, then evidence the closure — not the other way
round. Recorded so the timeline is not reconstructed more favourably later.

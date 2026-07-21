# Eval suite coverage (SE41)

This directory holds **eval-as-CI-test suites**: each drives the SDK through the
`Eval` harness (`Eval.create(...).run()` → `Scorers.*` → `assertEval`) so a
quality/reliability regression fails the pipeline. This file is the 100%
accounting of the public surface: every capability maps to an eval suite OR to
the unit/golden/contract tests that already cover it (utilities and pure infra
are not *agent-behavioral* and so are not eval targets — evals measure agent
output quality, not library internals).

Run: `pnpm eval` (deterministic suites always run; real-LLM suites run only when
`OPENROUTER_API_KEY` is set — see `.github/workflows/eval.yml`).

## Behavioral eval suites (`tests/eval/suites/`)

| Suite | Capability gated | Mode | Gate |
| --- | --- | --- | --- |
| `suite-agent-smoke` | eval-gate wiring (pass **and** fail) | canned agent | `assertEval` passes / throws |
| `suite-agent-qa-fixture` | agent QA / instruction-following (`.`) | fixture (real pipeline) | `minMeanScore` + `minPassRatio` |
| `suite-agent-tools-fixture` | tool-call loop / shell (`Tool.create`) | fixture | `minPassRatio` + `maxErrorRatio` |
| `suite-subagents-fixture` | subagent delegation (`/a2a`) | fixture | `minPassRatio` |
| `suite-mcp-fixture` | MCP tool listing (`mcpServers`) | fixture | `minPassRatio` |
| `suite-skills-fixture` | skills usage (`/skills`) | fixture | `minPassRatio` |
| `suite-context-fixture` | loaded project context (`/project`) | fixture | `minPassRatio` |
| `suite-memory-fixture` | memory recall/write (`memory`) | fixture | `minPassRatio` |
| `suite-websearch-fixture` | web-search tool pipeline (`providers`/`web_search`) | fixture | `minPassRatio` + `maxErrorRatio` |
| `suite-provider-fallback-fixture` | provider fallback resilience (`providers.fallback`) | fixture | `minPassRatio` + `maxErrorRatio` |
| `suite-error-gate` | row-error isolation + error-rate gate | canned agent | `maxErrorRatio` throws |
| `suite-scorers-coverage` | every deterministic scorer + per-scorer gate | canned agent | `perScorer` floors |
| `suite-qa-openrouter` | QA answer quality | real LLM (gated) | `minPassRatio` |
| `suite-structured-openrouter` | structured JSON output | real LLM (gated) | `minPassRatio` |

**Fixture mode** = a `theo_test_*` API key runs the REAL local agent pipeline
but returns baked-in deterministic responses (documented contract, like Stripe
test keys). These suites exercise the genuine capability with zero token spend
and always run in CI. **Real-LLM** suites use OpenRouter and are `skipIf`-gated
on the key (never persisted).

## Eval framework itself (`tests/eval/`)

The `@theokit/sdk/eval` module is covered by unit tests alongside these suites:

| Test | Covers |
| --- | --- |
| `eval-create` | `Eval.create` option validation (name, scorers, concurrency, trials) |
| `assert-eval` | `assertEval` + `EvalThresholdError` (every threshold, absent scorer) |
| `trials` | `EvalOptions.trials` expand/collapse + reliability semantics |
| `scorers-fuzzy` | `Scorers.levenshtein` + `Scorers.numericDiff` |
| `scorers-embedding-similarity` | `Scorers.embeddingSimilarity` (injected + real OpenRouter) |
| `llm-judge` | `Scorers.llmJudge` |
| `eval-persist` | crash-durable JSONL persist + resume |
| `m6-eval-harness` | `Scorers.verifyGate` + `captureArtifact` + `loadJsonl` (`/sandbox`) |

## Public subpaths not covered by evals (and why)

Evals measure agent/model output quality. Pure utilities and infrastructure are
verified deterministically by the SDK's unit/golden/contract suites instead —
listed here for completeness:

| Subpath | Nature | Covered by |
| --- | --- | --- |
| `/cron` | scheduler | `tests/**cron**`, golden cron-artifacts |
| `/workflow` | typed step orchestration | `tests/**workflow**` |
| `/task-store` | durable task persistence | `tests/**task**store**` |
| `/subscription` | SSE/WebSocket streaming | `tests/**subscription**` |
| `/client` | cloud HTTP client | contract/client tests |
| `/sandbox` | command sandbox | exercised by `Scorers.verifyGate` (`m6-eval-harness`) + sandbox tests |
| `/filesystem`, `/interactive` | provider seams | golden/contract seam tests |
| `/retry`, `/concurrency` | control-flow primitives | unit tests |
| `/path-safety`, `/sanitize` | security primitives | unit tests + `internal/security` |
| `/persistence`, `/internal/persistence` | storage primitives | unit tests |
| `/models`, `/messages`, `/compaction` | catalogs + readers | unit tests |
| `/errors`, `/server/auth`, `/server/errors-envelope` | error/authn contracts | unit + contract tests |

Adding an eval suite for one of these only makes sense once it has an
*agent-observable behavior* to grade; until then a unit/golden test is the
correct, non-flaky gate.

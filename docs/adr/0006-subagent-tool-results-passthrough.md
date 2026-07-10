# ADR 0006 — Subagent result-context control (`includeToolResults`, SE14)

- **Status:** Accepted (2026-07-10)
- **Milestone:** SE14 (SDK Evolution — a peer framework supervisor-agents parity)
- **Relates:** SE10 (child-send seam), SE12 (context IN — ADR 0005)

## Context

`defineSubAgent()` (`@theokit/sdk/a2a`) returns ONLY the child's final text
(`RunResult.result`) to the supervisor. a peer framework defaults to text-only and exposes
`includeSubAgentToolResultsInModelContext` to also fold the child's nested tool
results into the supervisor context.

`RunResult` exposes only `result?: string` — it carries no tool calls / results —
so surfacing the child's tool results needs one of:

1. a new additive `RunResult` field carrying tool results, OR
2. a capture from the child run's message stream.

## Decision

**Use a `run.stream()` capture — do NOT add a `RunResult` field.** When
`SubAgentSpec.includeToolResults` is `true`, `defineSubAgent` drives the child as
today (`agent.send(...)` → `run.wait()` for the final text), then **replays**
`run.stream()` (a proven, safe post-`wait()` idiom — see
`tests/runtime/error-packaging-e2e.test.ts`; the run buffers events and `stream()`
replays them, SE2) to collect every `tool_call` event with `status: "completed"`
(each carries `name` + `result`). The collected results are appended to the returned
delegation payload inside a delimited `<subagent-tool-results>` block. When
`includeToolResults` is absent/`false`, the child returns text-only — **unchanged**.

## Consequences

- **No `RunResult` change** — the capture reads the existing public `run.stream()`
  surface; zero new fields, zero wire/schema impact. The `SDKToolUseMessage`
  (`type: "tool_call"`) `args`/`result` are already `@public` (documented as
  non-stable-schema `unknown`), so no new exposure is created.
- **Text-only stays the default** (a peer framework's scoped posture): only an explicit
  `includeToolResults: true` widens the returned payload.
- **Tool args are NOT surfaced** — only completed tool *results* (name + result),
  matching a peer framework's "no nested tool arguments into the next model call" default.
- `result` is `unknown`; it is rendered as-is when a string, else `JSON.stringify`d.
- **Cost:** opt-in only; a supervisor that enables it accepts larger delegation
  payloads. A size cap is deferred (YAGNI) — documented as a follow-up if demand.

## Alternatives considered

- **New `RunResult.toolResults` field.** Rejected: a wider public surface + wire/
  schema-version implications for a capability that a `run.stream()` replay already
  delivers. Reopen only if a non-delegation consumer needs structured tool results
  off a `RunResult`.
- **Driving the child via `stream()` only (no `wait()`).** Rejected: extracting the
  final answer text from the stream is fiddler than reading `RunResult.result`; the
  `wait()`-then-`stream()`-replay idiom is proven and clearer.

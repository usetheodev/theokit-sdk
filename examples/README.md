# `@theokit/sdk` Examples

Self-contained example projects covering the SDK's public surface.
Each example is its own package — independent `package.json`,
independent install — so you can copy any folder out of this repo
and have a working starting point.

**68 examples** ship in this directory.

> **Index regenerated 2026-08-06.** The previous version of this file indexed 28 examples,
> **26 of which no longer existed** — the example set was renamed and expanded (`quickstart` →
> `agent-basics`, `memory` → `memory-basics`, `skills` → `skills-inline`, `subagents` →
> `subagents-basics`, …) and 66 real examples were missing from the index. The table below is
> generated from the directories actually on disk. The one-line summaries are taken from each
> example's own `README.md` (22 of 68 have one); examples with no README are
> listed by name only rather than described from guesswork. The old feature matrix, the
> "~100% of the public API" coverage claim and the DX-helpers cheat sheet all referenced removed
> examples and were dropped rather than rewritten from memory — re-add them from measured
> evidence when someone re-audits the set.

## Index

| Example | What it shows (from its own README) |
| --- | --- |
| [`a2a-mailbox`](./a2a-mailbox) | _no README in the example_ |
| [`abort-mid-stream`](./abort-mid-stream) | Demonstrates `AbortSignal` end-to-end propagation: caller's signal stops upstream token billing mid-stream |
| [`acp-server`](./acp-server) | Minimal `@theokit/acp` example: default-exports a per-session factory that creates a fresh `Agent` per ACP session |
| [`agent-basics`](./agent-basics) | The smallest end-to-end path with `@theokit/sdk`: create a local agent against your own provider key, send one message, await the result, dispose |
| [`agent-streaming`](./agent-streaming) | Iterate `run.stream()` to consume `SDKMessage` events as they arrive, instead of awaiting the whole result |
| [`agent-structured-output`](./agent-structured-output) | Coerce an agent's final answer into a validated, inferred-typed object with a Zod schema via `agent.generate(message, { output: schema })` |
| [`bedrock-bot`](./bedrock-bot) | One-shot Claude prompt via AWS Bedrock (`@theokit/sdk` Adoption Roadmap #8; ADRs D286-D302) |
| [`cache`](./cache) | Demonstrates `Cache.semantic` + `Cache.consult` (Adoption Roadmap #6; ADRs D249-D266) |
| [`cache-semantic`](./cache-semantic) | _no README in the example_ |
| [`cloud-payload`](./cloud-payload) | _no README in the example_ |
| [`compaction-basics`](./compaction-basics) | _no README in the example_ |
| [`concurrency-basics`](./concurrency-basics) | _no README in the example_ |
| [`context-inspect`](./context-inspect) | _no README in the example_ |
| [`conversation-storage`](./conversation-storage) | _no README in the example_ |
| [`cost-basics`](./cost-basics) | _no README in the example_ |
| [`custom-provider`](./custom-provider) | Register a custom OpenAI-/Anthropic-compatible LLM provider with `Provider.create` and route to it — no fork required |
| [`di-agent-express`](./di-agent-express) | _no README in the example_ |
| [`email-bot`](./email-bot) | _no README in the example_ |
| [`errors-catalog`](./errors-catalog) | _no README in the example_ |
| [`eval`](./eval) | Runs `Eval.create / .run` against a real LLM and prints aggregate + per-row results |
| [`eval-scorers`](./eval-scorers) | _no README in the example_ |
| [`file-based`](./file-based) | `.theokit/` files augment a **code-created** agent. The agent is still made with `Agent.create(...)`; opting in with `local.settingSources: ["project"]` makes it discover |
| [`filesystem-boundary`](./filesystem-boundary) | _no README in the example_ |
| [`goals-objective`](./goals-objective) | _no README in the example_ |
| [`guardrails`](./guardrails) | _no README in the example_ |
| [`guardrails-basics`](./guardrails-basics) | _no README in the example_ |
| [`handoffs`](./handoffs) | Triage agent → billing/support specialist. Demonstrates the `handoffs: []` declarative API |
| [`hooks-lifecycle`](./hooks-lifecycle) | _no README in the example_ |
| [`line-bot`](./line-bot) | _no README in the example_ |
| [`matrix-bot`](./matrix-bot) | _no README in the example_ |
| [`mattermost-bot`](./mattermost-bot) | _no README in the example_ |
| [`memory-basics`](./memory-basics) | _no README in the example_ |
| [`memory-lance`](./memory-lance) | How to opt into the **Lance backend** for `Memory.create` instead of the default SQLite-vec. Lance scales to >100k embeddings with HNSW-grade vector search — relevant when SQLite-vec p95 lat… |
| [`observability-events`](./observability-events) | _no README in the example_ |
| [`permissions-basics`](./permissions-basics) | _no README in the example_ |
| [`personality-switch`](./personality-switch) | _no README in the example_ |
| [`prompts`](./prompts) | Instructions are the system prompt — a plain string, a resolver evaluated per send, or a per-send override |
| [`providers-models`](./providers-models) | The model is chosen by the `vendor/model` id you pass to `Agent.create` plus the key. `@theokit/sdk/models` gives you offline helpers to parse an id and look up capabilities |
| [`reasoning`](./reasoning) | SE37 — `reasoning: true` turns a non-reasoning model into a reason→act→observe loop: it prepends a chain-of-thought preamble and auto-attaches the `think`/`analyze` scratchpad tools (same mo… |
| [`retry-primitive`](./retry-primitive) | _no README in the example_ |
| [`rules-path-scoped`](./rules-path-scoped) | _no README in the example_ |
| [`sandbox-exec`](./sandbox-exec) | _no README in the example_ |
| [`schedule-a-job`](./schedule-a-job) | _no README in the example_ |
| [`session-store-external`](./session-store-external) | _no README in the example_ |
| [`sessions-basics`](./sessions-basics) | _no README in the example_ |
| [`skills-google-workspace`](./skills-google-workspace) | _no README in the example_ |
| [`skills-inline`](./skills-inline) | _no README in the example_ |
| [`slack-bot`](./slack-bot) | _no README in the example_ |
| [`sms-bot`](./sms-bot) | _no README in the example_ |
| [`squad-basics`](./squad-basics) | A sequential `Squad` of two agents: a brainstormer proposes name ideas, a picker chooses the best |
| [`subagents-basics`](./subagents-basics) | _no README in the example_ |
| [`subscription-tracked`](./subscription-tracked) | _no README in the example_ |
| [`tasks`](./tasks) | Demonstrates the `Task` namespace from `@theokit/sdk` (Adoption Roadmap gap #2; ADRs D361-D374) |
| [`tasks-background`](./tasks-background) | _no README in the example_ |
| [`teams-bot`](./teams-bot) | _no README in the example_ |
| [`telegram-pro`](./telegram-pro) | _no README in the example_ |
| [`theocode-e2e`](./theocode-e2e) | _no README in the example_ |
| [`tool-advanced`](./tool-advanced) | _no README in the example_ |
| [`tool-basics`](./tool-basics) | Give an agent a typed tool with `Tool.create` — the model calls it when the prompt calls for it, and the Zod schema validates the arguments first |
| [`tool-hooks-tracking`](./tool-hooks-tracking) | Demonstrates `onToolStart` / `onToolEnd` / `onToolError` callbacks for cost tracking, audit log, latency telemetry |
| [`vertex-bot`](./vertex-bot) | One-shot Gemini (or Claude) prompt via GCP Vertex AI (`@theokit/sdk` Adoption Roadmap #8; ADRs D286-D302) |
| [`whatsapp-bot`](./whatsapp-bot) | _no README in the example_ |
| [`whatsapp-web-bot`](./whatsapp-web-bot) | _no README in the example_ |
| [`workflow-basics`](./workflow-basics) | A two-step `Workflow`: a `fn` step normalizes the input, an `agentStep` turns it into a one-sentence fact. Run with a real provider key: |
| [`workflow-parallel`](./workflow-parallel) | _no README in the example_ |
| [`workflow-retry`](./workflow-retry) | _no README in the example_ |
| [`workflow-suspend-resume`](./workflow-suspend-resume) | _no README in the example_ |
| [`workflows`](./workflows) | Multi-step pipeline: validate → classify (LLM) → branch (billing/support) → summarize |

## How to run an example

```bash
cd examples/agent-basics
pnpm install --ignore-workspace
cp .env.example .env   # paste your provider key (where needed)
pnpm dev
```

The examples link `@theokit/sdk` from the local source via
`file:../../packages/sdk`. `--ignore-workspace` prevents pnpm from
resolving the SDK through the monorepo workspace protocol.

Not every example ships a `.env.example` — skip that step where the file is absent.

## Provider credentials

Examples that drive a real LLM pick a model based on whichever
provider key is set in their `.env`. Auto-detection order:
**Anthropic → OpenAI → OpenRouter**.

```dotenv
ANTHROPIC_API_KEY=sk-ant-...
# or
OPENAI_API_KEY=sk-...
# or
OPENROUTER_API_KEY=sk-or-...
```

Plus a non-fixture SDK key (any string that does NOT start with
`theo_test_`) — examples default to `THEOKIT_API_KEY=user-real-example-key`.

## Why some examples use fixture mode

Fixture mode is triggered by an API key matching `theo_test_*` AND
the absence of `THEOKIT_API_BASE_URL`. The SDK serves deterministic,
contract-shaped responses without any network — useful for examples
that demonstrate **shape** (catalog reads, error types, cloud
lifecycle) without requiring credentials or a deployed PaaS. The
LLM-driven examples bypass fixture mode by using a non-fixture API
key + provider env credential.

## Maintenance

Every example in `manifest.json` runs against a real LLM on each push that touches
`examples/`, on every pull request, and nightly — see `.github/workflows/examples.yml`.
That workflow is the inventory's source of truth: an example that breaks fails CI.

When you add a new example, add a `README.md` to it, append a row to the **Index**
above, and register its slug in `manifest.json` so the workflow picks it up.


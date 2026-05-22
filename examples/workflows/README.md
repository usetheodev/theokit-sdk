# example: workflows declarativos

Multi-step pipeline: validate → classify (LLM) → branch (billing/support) → summarize.

Demonstrates the `Workflow.create / .then / .branch / .commit / .run` API
(Adoption Roadmap #5; ADRs D230-D248).

## Run (Ollama)

```bash
ollama serve &
ollama pull llama3.2:3b
pnpm install
pnpm run run
```

## Run (OpenRouter cloud)

```bash
export OPENROUTER_API_KEY=sk-or-...
pnpm run run
```

## What it shows

- `Workflow.create({ name }).then(fn(...)).then(agentStep(...)).branch(...).commit()` declarative DSL.
- `fn(id, handler)` for pure-function steps (validation, transformation).
- `agentStep(id, agent, promptTemplate)` for LLM-driven steps.
- `.branch([[predicate, [...]], [...]], { fallback })` first-match-wins routing.
- `WorkflowRun.stepResults` array with per-step status, attempts, duration.

## v1 limitations

- **LocalAgent only** (`CloudAgent` workflow steps throw `UnsupportedRunOperationError`, ADR D244).
- **Saga compensation deferred to v1.2** — `compensate?` slot reserved on `FnStep` but engine not yet implemented (ADR D238).
- **Persistence**: default in-memory. Use `Workflow.create({ persistence: { backend: "json", dir: ".theokit/workflows" } })` for filesystem snapshots.

## Other primitives not shown

- `.parallel([branchA, branchB], { concurrency })` — fan-out N concurrent branches.
- `.foreach("sourceStepId", innerStep, { concurrency })` — map over array output.
- `.dowhile(step, cond, { maxIterations })` — loop until predicate is false (default cap 100).
- `.sleep(ms)` — pause for fixed duration.
- `.suspend({ payloadSchema })` + `Workflow.resume({ runId, payload })` — human-in-the-loop.

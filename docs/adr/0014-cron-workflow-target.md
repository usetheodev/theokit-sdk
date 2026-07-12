# ADR 0014 — SE35: schedule a Workflow on the `Cron` primitive (instance, not id)

**Status:** Accepted (2026-07-11)
**Context slice:** SDK Evolution roadmap SE35 (a peer framework Schedules comparison, 2026-07-11).

## Context

The SDK ships `Cron` — cron-scheduled AGENT runs with full CRUD, IANA timezone, 5-field POSIX + nicknames, and two modes (`agentId` reuse vs `agent` ephemeral). a peer framework **Schedules** add scheduling a **workflow** on the same surface (`a peer framework.schedules.create({ workflowId, cron, inputData })`). SE35 takes that runtime-legitimate slice: a `Cron` job MAY target a shipped `Workflow` (SE27–30).

The roadmap draft assumed a `workflowId` + resolver-registry seam, mirroring how `agentId` is resolved via `getAgentFacade()`. Discovery refuted that premise.

## Discovery findings that shaped the decision

1. **The cron store is IN-MEMORY only.** `internal/cron/store.ts` is a `Map<string, CronJob>` with the note: *"Phase 1 we keep all jobs in memory (across local + cloud runtimes). Local-runtime persistence to `.theokit/cron/jobs.json` lands when the local runtime adapter is wired."* There is **no disk serialization today**.
2. **The `agent` field is already an in-memory object.** `CronJob.agent: AgentOptions` is held in the in-memory job as-is; there is no serialization boundary a `Workflow` instance would cross that the `agent` field does not.
3. **`run-job.ts` can call `.run()` on a held instance** without importing `workflow.ts` — the instance carries its own `.run` method, so there is no dependency-direction problem and no need for a `getWorkflowFacade()` registry (unlike `agentId`, which needs `getAgentFacade().resume()` because the job holds only a string).
4. **a peer framework needs `workflowId` because it has a `a peer framework`-instance registry** (`workflows: { ... }`). TheoKit has no such registry — a `Workflow` is an in-memory instance minted by `Workflow.create(opts).commit()`.

## Decision

**D1 — The workflow-target job holds the `Workflow` INSTANCE, not a `workflowId`.** `CronCreateOptions` / `CronJob` gain `workflow?: Workflow` + `inputData?: unknown`, MUTUALLY EXCLUSIVE with `agent`/`agentId` (exactly one target). This mirrors the existing in-memory `agent: AgentOptions` field. **No `workflowId`, no workflow resolver registry, no `getWorkflowFacade()`** — those solve a serialization problem that does not exist while the store is in-memory (YAGNI / parsimony rung 1).

**D2 — `message` is forbidden with a `workflow` target.** An agent target takes a chat `message`; a workflow target takes `inputData`. Pairing `message` with `workflow` is a `ConfigurationError` (`cron_workflow_message`) at `createCronJob`. The XOR guard extends the existing `agent`-XOR-`agentId` check: exactly one of `{agent, agentId, workflow}` (`cron_no_target` / `cron_ambiguous_target`).

**D3 — `runCronJob` returns `Run | WorkflowRun`; the fire handler branches on shape.** `workflow` ⇒ `job.workflow.run(job.inputData)` (returns the already-terminal `WorkflowRun`); `agent`/`agentId` ⇒ unchanged (`agent.send(message)` → `Run`, still deferred). The `setCronFireHandler` Task wrap in `cron.ts` handles both: an agent `Run` has `.wait()`/`.cancel()` (abort-wired); a `WorkflowRun` is already terminal (no `.wait()`) — the wrap records its `status`/`id` directly. `run-job.ts` calls `.run()` on the held instance and does NOT import `workflow.ts` (dependency direction preserved).

**D4 — Fire lifecycle hooks (`prepare`/`onFinish`/`onError`/`onAbort`) are DEFERRED.** No concrete consumer needs fire-time param computation or outcome reaction yet (YAGNI / G11). **Named re-eval trigger (both required to reopen):** (1) a shipped app schedules an agent OR workflow via `Cron` end-to-end, AND (2) reports concrete pain that it must compute fire-time params or react to the outcome from inside the SDK. Until then the Task-registry wrap already exposes fire outcomes observably (`Task.subscribe`), covering the observability need without a hook API.

**D5 — Future disk-persistence asymmetry is a documented known-limitation, not solved now.** When the local disk-persistence adapter is wired (an unbuilt milestone), an `agent: AgentOptions` job serializes but a `workflow: Workflow` instance does not. THAT milestone will introduce an id+resolver for workflow jobs (and serialization for agent jobs) — driven by a real persistence consumer. SE35 does not pre-build it.

## Consequences

- Minimal surface: two optional fields (`workflow`, `inputData`) + a widened `runCronJob` return + a handler branch. No new module, no registry, no id concept.
- The in-process (local) scheduler path — the only wired runtime — works end-to-end for workflow jobs.
- Cloud-runtime workflow jobs are out of SE35 scope (cloud dispatch is server-side; a `Workflow` instance can't cross the process boundary — same as the disk-persistence limitation).

## Alternatives rejected

- **`workflowId` + a `getWorkflowFacade()` resolver registry (roadmap draft).** Rejected — solves a serialization problem that does not exist (in-memory store); a new registry subsystem with no consumer is YAGNI. Revisited only when disk persistence lands (D5).
- **Persist a workflow *definition* (steps as data) in the job.** Rejected — a `Workflow` is code (step fns are closures); serializing a definition is a much larger surface and still cannot capture arbitrary step logic. Out of scope.
- **Ship the fire hooks now.** Rejected — undemanded; the Task-registry wrap already gives observable outcomes. Deferred with a trigger (D4).

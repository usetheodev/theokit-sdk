# ADR 0010 — Workflows-as-steps via an opaque `workflowStep` factory (SE30)

- **Status:** Accepted (2026-07-11)
- **Milestone:** SE30 (SDK Evolution — a peer framework Workflows parity)
- **Relates:** the workflow executor (ADRs D230-D248), SE19 (`workflowAsTool`), SE27/SE28/SE29 (workflow surface)

## Context

a peer framework lets `.then(childWorkflow)` nest a committed workflow as a step, and
`cloneWorkflow(wf, { id })` reuse logic under a new id. TheoKit's `.then()`
accepts only a `Step` (a `Workflow` is not a `Step`), and there is no clone.

Two design axes needed a decision:

1. **How to express a nested workflow** — overload `.then()` to accept a
   `Workflow`, or a dedicated `workflowStep(child)` factory.
2. **Nested suspend/resume** — TheoKit's resume continues from `stepIdx + 1`
   (AFTER the suspended step). A nested child that suspends cannot be resumed
   through the parent: on parent resume the wrapping step is skipped, so the child
   would never complete. Addressing a nested step inside a snapshot would require a
   nested-path snapshot shape.

## Decision

**Ship `workflowStep(child, { id? })` — an OPAQUE factory that wraps the child as
an `FnStep`** — NOT an overload of `.then()`. The child runs in its OWN executor
(its own runId, single-flight lock, and step-id space); its output becomes the
step output. A committed workflow is used as `.then(workflowStep(child))`.

**Nested suspend/resume is NOT supported in v1.** A child that ends `completed`
flows its output on; any other terminal status (`failed` / `suspended` /
`cancelled`) fails the parent step with a typed `WorkflowNestedError`. For
`suspended`, the error explicitly says nested suspend/resume is unsupported in v1
— restructure with a top-level suspend.

**`cloneWorkflow(wf, { id })`** returns a new independent `Workflow` with the same
committed steps under a new name + a freshly minted `workflowId` (so clones have
separate single-flight locks + observability identities).

## Consequences

- **No new `Step` kind, no executor change** — `workflowStep` reuses `FnStep`
  (parsimony). The child is opaque to the parent executor.
- **Step-id uniqueness across nesting is a non-issue** — the child's internal ids
  live in the child's own space; the parent sees ONE `FnStep` id. `validateUniqueIds`
  needs no nesting-aware change.
- **`.then()` stays typed to `Step`** — no magic overload; the factory is explicit
  and consistent with `fn` / `agentStep` / `workflowAsTool`.
- **Honest limitation** — nested suspend fails fast with a clear typed error rather
  than silently skipping the child on resume (the broken alternative). No footgun.
- **Cancellation propagates** — the parent step forwards `ctx.signal` to
  `child.run`, so aborting the parent aborts the child.

## Alternatives considered

- **Overload `.then(workflow)` to accept a `Workflow`.** Rejected: it makes `.then`
  polymorphic over `Step | Workflow`, blurs the typed step contract, and is more
  "magic" than an explicit factory. Reopen only if the factory proves ergonomically
  painful in shipped apps.
- **Support nested suspend by re-running the child from start on resume (opaque
  re-run).** Rejected for v1: re-running a nested child on resume silently
  re-executes its side effects — a footgun worse than a clear failure. The typed
  error is the honest v1 posture.
- **Support nested suspend via a nested-path snapshot address.** Deferred: it needs
  a `WorkflowSnapshot` shape change (a step path, not a single `currentStepId`) and
  resume logic that descends into the nested workflow. A future ADR with demand
  evidence; the `WorkflowNestedError` message points users at the top-level-suspend
  workaround meanwhile.

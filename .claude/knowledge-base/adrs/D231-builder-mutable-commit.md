# D231 — Builder mutates internally + returns immutable `Workflow` after `.commit()`

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Chainable methods (`.then`, `.parallel`, `.branch`, `.foreach`, `.dowhile`, `.sleep`, `.suspend`) mutate an internal `steps[]` array and return `this`. `.commit()` validates the graph (unique step IDs, references), mints a `workflowId`, and returns a frozen `Workflow` instance.

## Rationale

Mastra v1 uses this pattern; familiar to developers migrating. Recursive type-refinement Builder (each `.then` returns a new typed builder) blows the TS type recursion budget at chain length > 10. Mutable internal state with single generic propagation keeps inference cheap.

## Consequences

- Workflows are not forkable post-commit — must construct fresh.
- Tests can inspect `builder.steps` array directly during construction.
- No fork/snapshot of an in-progress builder; mutation is local and bounded.
- Builder asserts `!this.committed` on each chained method to catch reuse-after-commit.

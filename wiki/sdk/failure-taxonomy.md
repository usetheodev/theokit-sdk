---
type: Design Guide
title: Failure taxonomy
description: Six failure classes with the right response and the wrong response to each, plus the import-identity trap that produces a catch which does not catch.
tags: [reliability, errors, retry, taxonomy]
generated: { by: claude-opus-5/okf-0.2, at: 2026-08-06T00:00:00Z }
status: stable
stale_after: 2026-11-06
sources:
  - id: course
    resource: docs/course/theokit-agent-ai-course.md (v1.0, 2026-07-30), Module 7.1, absorbed into this bundle 2026-08-06
    title: Agent AI course, Module 7.1 — failure taxonomy
    author: human:paulohenriquevn
    last_modified: 2026-07-30
  - id: errors
    resource: packages/sdk/src/errors.ts and packages/sdk/src/internal/error-mappers/
    title: Error classes and provider mappers — verified at @theokit/sdk@4.36.0 on 2026-07-30
---

# The six classes

Treating every failure the same is the error that produces both downtime and runaway spend:

| Class | Examples | Correct response | Wrong response |
| --- | --- | --- | --- |
| **Transient** | 429, 5xx, `ECONNRESET`, network timeout | retry with backoff + jitter | fail in the user's face |
| **Permanent (config)** | invalid key, nonexistent model | fail fast and clearly | retry (burns quota) |
| **Domain** | a business rule was violated | typed error, no retry | retry (violates the rule twice) |
| **Context** | window overflow | compact and resend | identical retry |
| **Policy** | a guardrail or permission denied | report as policy | treat as a bug |
| **No progress** | doom loop | stop and diagnose | raise `maxIterations` |

The last row is [doom loop](/concepts/doom-loop.md); the policy row is
[guardrails](/sdk/guardrails.md) and [permissions](/sdk/permissions.md); the context row is
[context engineering](/concepts/context-engineering.md).

# One taxonomy, not several

The SDK ships the classification, and its value is that there is exactly **one**:

```typescript
import { isTransientError, TheokitAgentError, RateLimitError } from "@theokit/sdk/errors";
import { Retry } from "@theokit/sdk/retry";

const res = await Retry.create(() => callApi(), {
  retries: 3,
  isRetryable: isTransientError,
  initialDelayMs: 200,
});
```

`isTransientError(err)` returns true for 429 / 5xx / network / `ECONNRESET` on a
`TheokitAgentError`. Which provider status maps to which code is
[error codes](/reference/error-codes.md).

# The trap that costs hours

> Import `isTransientError` and the error classes from **the same entry** —
> `@theokit/sdk/errors` *or* the barrel, never half of each.

`instanceof` is sensitive to class identity. Mixing entries produces the worst kind of bug:
**the `catch` that does not catch.** The capability map carries the same warning inline, next
to the import.

# What a good handler looks like

```typescript
try {
  const result = await run.wait();

  if (result.tripwire !== undefined) return handlePolicyBlock(result);       // policy, not error
  if (result.status === "cancelled") return;                                  // not an error at all
  if (result.stoppedByDoomLoop) return investigateTool(result);               // no progress
  if (result.stoppedAtIterationLimit) return continueOrReportTruncation(run); // truncated
  if (result.status !== "finished") return handleError(result.error);

  return result.result;
} catch (err) {
  if (!(err instanceof TheokitAgentError)) throw err;   // not ours — let it rise
  if (isTransientError(err)) return retryWithBackoff();
  throw err;                                            // permanent: fail fast, fail clear
}
```

Note what is *not* here: no bare `catch {}`, no `null` returned to signal failure, no generic
"an error occurred". A swallowed error is the most dangerous class of bug, because the system
keeps running while data corrupts.

The signals branched on above are catalogued in [run signals](/sdk/run-signals.md), and the
seven terminals they correspond to are [loop terminals](/concepts/loop-terminals.md).

# Mastery criterion

You provoke all six classes deliberately and write a handler that does the right thing in
each. That handler is the skeleton of a production agent — and its checklist form is
[production readiness](/operations/production-readiness-checklist.md).[^course]

[^course]: Agent AI course, Module 7.1

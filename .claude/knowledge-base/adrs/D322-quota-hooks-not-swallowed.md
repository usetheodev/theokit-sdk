# D322 — Quota hook errors propagate (NOT swallowed)

**Status:** Accepted
**Date:** 2026-05-25
**Related:** Production-Readiness plan Phase 6, T6.2 + T6.3

## Decision

`onBeforeCreate` and `onBeforeSend` callbacks are ADMISSION GATES, not observers. When they throw or reject, the error propagates as the rejection of `Agent.create` / `agent.send`. Errors are NOT swallowed (in deliberate contrast to D309 / D317 observation hooks).

## Rationale

**These hooks exist to BLOCK operations.** Silently swallowing a quota-exceeded error would defeat the entire purpose:

```ts
onBeforeCreate: async ({ userId }) => {
  if (await countConversations(userId) >= 100) {
    throw new QuotaExceededError("100 conversations per user max");
  }
}
```

If this hook's throw were swallowed, the SaaS multi-tenant deploy would allow unlimited conversations per user — exactly the abuse the handoff identified.

Match the pattern of `pre_tool_call` veto (D101): blocking decisions propagate; observation decisions are swallowed.

## Alternatives considered

- **Make all hooks consistent (swallow errors)** — rejected. Removes the only enforcement path for multi-tenant quota.
- **Add a separate "veto" return value (boolean / object)** — rejected. The throw idiom matches JavaScript norms (`fetch` rejects with HTTP errors, `JSON.parse` rejects with malformed JSON). Less surface to learn.

## Consequences

- Consumers MUST handle quota errors at the call site (try/catch around `Agent.create` / `agent.send`).
- Documentation calls this distinction out: "onBeforeCreate / onBeforeSend are blockers — their throws propagate".

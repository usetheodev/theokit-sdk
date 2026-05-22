# D219 — `inputFilter` is the single extension point for history scoping

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Handoff customization happens via ONE callback: `inputFilter(history) => history`.
No `outputFilter`, no `historyMapper`, no separate redactor.

```ts
Handoff.create(target, {
  inputFilter: (h) => ({ messages: h.messages.slice(-3) }),  // keep last 3
});
```

## Rationale

- OpenAI Agents has only `inputFilter`. LangGraph has no equivalent (consumers
  manipulate graph state directly).
- One filter is enough — output filtering is the receiver's responsibility
  via its own system prompt / tools.
- Multiple extension points proliferate complexity for marginal use cases.

## Consequences

- Enables one clear customization point.
- Constrains: callers wanting receiver-output transformation must do it in
  the receiver's prompt or via `pre_tool_call` hook.

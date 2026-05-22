# D223 — `inputType` is a Zod schema (optional peer dep, lazy-loaded)

**Date:** 2026-05-22
**Status:** Accepted

## Decision

Optional structured payload for the handoff tool call:

```ts
Handoff.create(target, {
  inputType: z.object({ reason: z.string(), priority: z.enum(["low", "high"]) }),
  onHandoff: (ctx, parsed) => {  // parsed: { reason, priority }
    log({ ...parsed, transferTo: ctx.receiverAgentId });
  },
});
```

When `inputType` is set, the synthetic tool's `inputSchema` is the JSON
schema; LLM-provided args are Zod-parsed before `onHandoff` fires.

## Rationale

- Same pattern as `generateObject` / `streamObject` / `Eval` (D199).
- Zod is the SDK's chosen validation lib (peer dep, opt-in).
- Mirrors OpenAI Agents `input_type`.

## Consequences

- Enables structured handoff payloads with type safety.
- Constrains: Zod must be installed when `inputType` is set (consistent with
  other SDK surfaces that use Zod).

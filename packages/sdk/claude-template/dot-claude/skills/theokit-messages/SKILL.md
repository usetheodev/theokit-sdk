---
user-invocable: false
paths:
  - "**/*message*"
  - "**/*Message*"
description: TheoKit SDK message readers — assistantText, extractToolUses, costAmountUsd over the SDKMessage stream
---

# TheoKit Messages

Pure readers over the `SDKMessage` stream — no I/O, no mutation, deterministic.
Use these instead of re-implementing a wire-event mapper.

```typescript
import { assistantText, extractToolUses, costAmountUsd } from "@theokit/sdk/messages";
import type { SDKMessage, ToolUseBlock } from "@theokit/sdk";
import type { CostBreakdown } from "@theokit/sdk";
```

## `assistantText(msg)` — concatenate assistant text blocks

Returns `""` for any non-assistant message (or an assistant with no text
blocks). `tool_use` blocks are ignored — only `text` blocks contribute.

```typescript
for await (const event of run.stream()) {
  // event is an SDKMessage; assistantText is safe on any variant
  const text = assistantText(event);
  if (text) process.stdout.write(text);
}
```

## `extractToolUses(msg)` — read assistant `ToolUseBlock`s

Returns `[]` for any non-assistant message. This reads the assistant message's
content blocks — NOT the separate `tool_call` lifecycle event (a different
stream). Tool `input` is `unknown`; parse it defensively.

```typescript
const uses: ToolUseBlock[] = extractToolUses(event);
for (const use of uses) {
  console.log(use.name, use.id); // use.input is `unknown` — validate before use
}
```

## `costAmountUsd(cost)` — honesty-preserving cost read

Returns `number | undefined`. `undefined` means "cost unknown" — distinct from a
real `$0` (e.g. a subscription-included route). NEVER coerced to 0.

```typescript
const amount = costAmountUsd(cost); // cost: CostBreakdown | undefined
if (amount === undefined) {
  console.log("cost unknown");
} else {
  console.log(`$${amount.toFixed(4)}`);
}
```

---
user-invocable: false
paths:
  - "**/*compact*"
  - "**/*Compact*"
description: TheoKit SDK compaction reference — compactTranscript, shouldCompact, checkpoints, context-overflow
---

# TheoKit Compaction

Public context-management helpers. Every function is pure and never mutates its
input. A `CompressibleMessage` is `{ role: "user" | "assistant" | "system"; content: string }`.

```typescript
import {
  compactTranscript,
  shouldCompact,
  estimateTokens,
  buildCheckpoint,
  filterFromLatestCheckpoint,
  isContextOverflowError,
  CHECKPOINT_MARKER,
  SUMMARY_TEMPLATE,
  type CompactTranscriptOptions,
  type ShouldCompactInput,
  type CompressibleMessage,
} from "@theokit/sdk/compaction";
```

## Pre-call gate — `estimateTokens` + `shouldCompact`

`estimateTokens` is a tokenizer-free `ceil(text.length / 4)` heuristic — a cheap
gate, NOT exact tokenization. `shouldCompact` is pure: the caller supplies the
model's window.

```typescript
const estimated = estimateTokens(transcript.map((m) => m.content).join("\n"));

const input: ShouldCompactInput = {
  estimated,
  contextWindow: 200_000,
  buffer: 8_000,     // headroom to reserve (output + safety margin)
  maxOutput: 4_000,  // optional; separate response reservation (default 0)
};

if (shouldCompact(input)) {
  // compact before sending — see below
}
```

## `compactTranscript` — summarize the older window

Default `keepRecent` mode keeps the last N turns verbatim (default 6) and
preserves leading system prompts. The older window is summarized via the
caller-supplied `summarize` callback (or dropped if omitted). With `failSafe`, a
thrown summarizer returns the ORIGINAL transcript instead of propagating.

```typescript
const opts: CompactTranscriptOptions = {
  keepRecent: 6,        // OR keepTokens: 40_000 (token-budget mode, takes precedence)
  failSafe: true,
  summarize: async (older: CompressibleMessage[], template: string) => {
    // template is SUMMARY_TEMPLATE unless overridden via summaryTemplate
    const summary = await callYourModel(template, older);
    return { role: "system", content: summary };
  },
};

const compacted = await compactTranscript(transcript, opts);
```

## Checkpoints — mark and filter

`buildCheckpoint` produces a `system` turn whose content starts with
`CHECKPOINT_MARKER`. `filterFromLatestCheckpoint` returns turns relative to the
most recent marker (`include: "after"` excludes it — the default; `"from"`
includes it).

```typescript
const marked = [...transcript, buildCheckpoint("milestone: tests green")];

const recent = filterFromLatestCheckpoint(marked);              // after (exclusive)
const withHead = filterFromLatestCheckpoint(marked, { include: "from" });
```

## Context-overflow detection

`isContextOverflowError` is `true` only for a `TheokitAgentError` reporting the
typed `context_too_long` code — never a brittle message regex.

```typescript
try {
  await agent.send(prompt);
} catch (err) {
  if (isContextOverflowError(err)) {
    const compacted = await compactTranscript(transcript, { keepRecent: 4 });
    // retry with the compacted transcript
  } else {
    throw err;
  }
}
```

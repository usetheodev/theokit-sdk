# D155 — Per-file 40k + aggregate 120k size caps

**Date:** 2026-05-20
**Status:** Accepted

## Decision

Per-file cap: **40_000 chars** (~10k tokens). Aggregate cap across all
context files: **120_000 chars**. Truncation: 70% head + 20% tail +
`…[truncated by theokit]` marker. EC-C guard: when `max <= MARKER.length`,
return head-only slice without the marker (prevents `budget < 0` bug).

Both caps configurable via `ContextSettings.maxBytesPerFile` /
`maxBytesTotal`.

EC-S: 120k aggregate is appropriate for ≥1M-token windows (Claude
Sonnet 4 = 1M, Gemini 2.5 = 2M). Users on smaller models (Haiku 200k)
should override `maxBytesTotal` to leave room for the rest of the
prompt.

EC-P: non-UTF-8 / null-byte content is accepted as-is (mojibake via
`readFile(... "utf8")` replacement chars). KISS — users who put binary
in `.md` get what they wrote.

EC-H: truncation operates on JS string indices (UTF-16 code units),
which can split surrogate pairs at boundaries. We tolerate occasional
U+FFFD replacement chars; LLMs handle them gracefully.

## Rationale

Hermes's 20k per-file is tight for 2026. We doubled it because context
windows have grown. 120k aggregate stays well under any prompt-cache
breakpoint. 70/20 head/tail mirrors Hermes — heads carry anchor
sections (project name, conventions), tails preserve "## Don't do this"
closers. Anthropic's own recommendation (<200 lines per CLAUDE.md, ~6-8k
chars) suggests 40k is a hard ceiling, not a target.

## Consequences

- **Enables:** predictable token budget; works across all model sizes;
  prompt-cache friendly.
- **Constrains:** users with >40k char files lose middle content;
  caller can configure higher via public API.

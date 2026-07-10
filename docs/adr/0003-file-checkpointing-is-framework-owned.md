---
status: accepted
date: 2026-07-09
deciders: paulo
consulted: claude
informed: theokit-maintainers
---

# ADR 0003: File checkpoint/rewind is a framework/tool-layer concern, NOT an `@theokit/sdk` runtime primitive

## Context and Problem Statement

The Anthropic Agent SDK ships `enableFileCheckpointing` + `rewindFiles()`: the runtime
snapshots the working tree before a turn and can roll files back to a prior message. Milestone
**SE5** (SDK Evolution roadmap) asks whether `@theokit/sdk` should adopt an equivalent.

SE5 is a **GATED** milestone: its Definition of Done is *an ADR ruling runtime-vs-framework
ownership — no code before it*. This ADR is that gate.

The question is architectural, not feature-level: **can the SDK runtime own file
checkpoint/rewind cleanly, given its design?**

## Decision Drivers

- `@theokit/sdk` is **bring-your-own-tools (BYO-tools)**. It ships **no** built-in
  Read/Write/Edit/Bash tools — verified: `grep` for a `name: "read"|"write"|"edit"|"bash"` tool
  in `packages/sdk/src` returns nothing. Tools are consumer-supplied `CustomTool`s with an opaque
  `handler` (`src/types/agent-prims.ts`).
- The **agent loop is tool-agnostic**. `internal/agent-loop/` dispatches tool calls and accounts
  tokens/cost; it performs **no file I/O** and has **no knowledge of the filesystem**. The only
  `*Write*` symbols in the loop are `cacheWriteTokens` (usage accounting), not file writes.
- Anthropic *can* checkpoint files because **their** SDK owns the file tools (the subprocess /
  CLI-wrapper model, where Read/Write/Edit are first-party). That coupling is exactly what the
  `@theokit/sdk` architecture rejects (see the roadmap "Explicitly out of scope": *built-in coding
  tools* and *subprocess/CLI-wrapper model* are both non-goals).

## Considered Options

1. **Runtime-owned checkpoint/rewind primitive** — the loop snapshots the working tree before each
   turn and exposes `rewind(messageId)`.
2. **Framework/tool-layer owned** — checkpointing lives where file mutation actually happens (the
   consumer's tools / the coding-agent framework, i.e. TheoKit), not in the runtime.
3. **Defer indefinitely** — take no position.

## Decision Outcome

Chosen option: **(2) Framework/tool-layer owned.** File checkpoint/rewind is **out of scope for the
`@theokit/sdk` runtime** and is closed as TheoKit/tool-layer territory. **No SDK code ships for SE5.**

### Rationale

A runtime checkpoint primitive requires the runtime to know **which files changed in a turn**. In a
BYO-tools model the runtime cannot know this: a `CustomTool.handler` may write anywhere (or nowhere),
over any I/O boundary (local FS, a remote API, a database), entirely opaque to the loop. Any
"runtime" checkpoint would therefore have to either:

- snapshot the **entire working tree** before every turn (unbounded cost, wrong layer — the runtime
  has no business owning the user's filesystem), or
- require tools to **report their file mutations** to the runtime (a new tool contract that couples
  every tool to a filesystem-checkpoint protocol — precisely the coupling BYO-tools avoids).

Both contradict the runtime's design. The layer that **owns the file-editing tools** is the only
layer that knows what to snapshot and when. In the TheoKit ecosystem that is the **coding-agent /
tool layer**, not the agent runtime.

### Where it belongs instead

- A TheoKit (or any consumer) coding-agent that ships Read/Write/Edit tools owns file
  checkpoint/rewind, keyed to **SE4 session message ids** (`RunResult`/transcript message ids are the
  natural rewind anchor — the SE4 dependency stands). The tool layer wraps its own edits with a
  snapshot and exposes rewind — it has the file-mutation visibility the runtime lacks.
- If a future consumer needs a runtime *hook* to correlate a checkpoint with a message id, that is a
  thin, additive observability seam (a message-id accessor) — NOT a filesystem-owning primitive. It
  would require its own ADR with a concrete consumer request.

### Consequences

- **Positive:** the runtime stays filesystem-agnostic and tool-agnostic; no coupling to a coding
  model; no unbounded working-tree snapshot cost; SE5 closes with a principled boundary.
- **Negative:** consumers wanting file rewind must implement it at the tool layer. Acceptable — they
  own the file tools, so they own the snapshots. This mirrors every other BYO-tools boundary.

### Re-evaluation triggers (all three required to reopen)

1. `@theokit/sdk` reverses the BYO-tools decision and ships first-party file-editing tools (it will
   not — that is a locked non-goal).
2. A concrete consumer demonstrates a runtime checkpoint need that the tool layer provably cannot
   satisfy with SE4 message ids as the anchor.
3. A file-mutation reporting contract is designed that does not couple every tool to a filesystem
   protocol.

## More Information

- Roadmap: SE5 (`ROADMAP.md`, "SDK Evolution (post-Harness)"), closed by this ADR.
- Related non-goals: "Built-in coding tools" and "Subprocess / CLI-wrapper model" (roadmap
  "Explicitly out of scope").
- Dependency satisfied: SE4 (session message ids) provides the rewind anchor the tool layer uses.

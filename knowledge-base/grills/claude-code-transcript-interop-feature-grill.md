---
slug: claude-code-transcript-interop
generated_by: roadmap-feature
milestone_id: SE39
date: 2026-07-15
status: completed
---

# Feature grill — Claude Code transcript interop (SE39)

## Q1 — What is this feature and why NOW?
A Claude-Code-compatible `.jsonl` transcript **writer** for `@theokit/sdk` sessions, so the Claude Code
ecosystem's read-side tools (`claude-code-log`, `ccusage`, `claude-devtools`, viewers) can parse SDK
sessions, and to lay the groundwork for functional `--continue`. **Why now:** the owner wants Claude
Code ecosystem interoperability; the gap was diagnosed with evidence — the SDK on-disk store flattens
each turn to `{ role, content, at }`, destroying the `tool_use_id ↔ tool_result_id` pairing + `uuid`/
`parentUuid` DAG the format requires.

## Q2 — Dependencies (which milestones must be `[x]`)?
SE38 `[x]` (most recent). Real base is the existing `ConversationStorage` seam (already shipped). No
other milestone blocks it.

## Q3 — Definition of Done?
**Scope decision (owner, 2026-07-15 via AskUserQuestion): PHASED → `--continue`.** SE39 delivers the
opt-in, additive read-only writer (structured blocks + uuid/parentUuid envelope + correct
`~/.claude/projects/` path + secret redaction + a round-trip test that parses through a real ecosystem
parser and validates against a captured transcript). Functional `--continue` (real CLI resume,
extended-thinking signature handling per #63147, `leafUuid`/`summary` resume pointers, sidecar dirs,
`agent-*.jsonl` subagents) is **deferred to SE40, ADR-gated**. Full DoD in `ROADMAP.md § SE39`.

## Q4 — Top 2 NEW risks?
1. **Format officially unstable** — Anthropic states the `.jsonl` format is internal + changes between
   versions (recommends `/export`). Mitigation: opt-in + additive + read-only + version-pinned + CI
   validation against a captured transcript; `--continue` gated to SE40.
2. **Extended-thinking block signature** — `thinking` blocks carry a cryptographic signature; wrong
   emission breaks resume (`400 "thinking blocks cannot be modified"`, upstream #63147). Mitigation:
   emit faithfully per the round-trip test; resume-critical handling deferred to SE40.

## Out-of-scope cross-check
Ran against `### Explicitly out of scope`. No violation: the vetoed items are about NOT becoming a
Claude-Code clone (bundled toolset, subprocess model). An interop/export adapter is a **bridge**
(open-stack narrative), not a clone — reaffirmed in the SE39 Objective. `out_of_scope_overlap:
false_positive` (keyword "Claude-Code" appears in the veto prose but the semantics are opposite).

## SOTA delta
3 permissive peers cloned (MIT/Apache-2.0): `claude-code-log`, `claude-code-transcripts`,
`claude-code-jsonl-parser`. Deep-research sources + findings distilled in
`knowledge-base/discoveries/blueprints/claude-code-transcript-interop-blueprint.md`.

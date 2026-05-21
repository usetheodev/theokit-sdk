# D167 — Personality `tools:` is advisory; additive narrowing per D102 layer 4

**Date:** 2026-05-20
**Status:** Accepted

## Decision

When the active personality declares `tools: [...]`, the SDK filters
the exposed `customTools` set to that whitelist for the current run.
References to tools the agent has not registered are dropped with a
one-shot stderr warning (with a "did you mean: X" hint via Levenshtein
distance ≤2 when applicable). The personality whitelist NEVER adds
tools (subtractive only); the existing `pre_tool_call` veto (D101) still
wins.

**EC-I:** MCP-style names (`mcp__server__tool`) are matched as exact
strings — not regex.
**EC-15:** Duplicate entries in `tools:` are deduped silently.
**EC-17:** Missing names within Levenshtein distance ≤2 emit a hint.

## Rationale

Hermes #26 calls personality presets the place where consumers expect
to tune **voice + behavior**, including which tools are appropriate for
a given persona ("editor mode" should not run `exec`). Advisory
(not authoritative) preserves the safety net of `pre_tool_call` veto
and avoids brittle hard-deny semantics when the whitelist is stale.

## Consequences

- **Enables:** "no-shell coder" / "read-only reviewer" presets.
- **Constrains:** builtin tools managed deeper in the agent loop are
  not filterable by this seam — `customTools` (defineTool + plugin
  tools) are the affected catalog. Documented in the preset README.

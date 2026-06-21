# Edge Case Review — m4-tool-scoping

Date: 2026-06-21
Plan analyzed: knowledge-base/plans/m4-tool-scoping-plan.md
Tasks analyzed: 3 (T1.1 field+frontmatter, T1.2 scope bridge, T2.1 barrel/wiring)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

## Boundary map

Two pure boundaries: the frontmatter `tools` parse (text → string[]) and the scope bridge (`AgentDefinition.tools` → `withToolWhitelist` Set). Enforcement is the EXISTING, wired `checkToolWhitelist` (no new dispatch logic). No I/O beyond the loader's existing read; concurrency is handled by the AsyncLocalStorage the bridge reuses. Residual edges: parse robustness (separators/empties), the empty-list semantics, scope nesting, and name-case exactness.

## MUST FIX

(none — additive field + a thin bridge over the already-wired enforcement; backward-compat preserved by undefined→passthrough.)

## SHOULD TEST

### EC-1: frontmatter `tools` with mixed separators / blank entries
- **Affected task:** T1.1
- **Family:** Format
- **Scenario:** `tools: read_file,  list_dir ,` (extra spaces, trailing comma, double space) must parse to `["read_file","list_dir"]` — no empty strings in the whitelist (an empty string would never match a tool name and just bloats the Set).
- **Suggested test:** `subagent_tools_frontmatter_trims_and_drops_empties` — the messy frontmatter → exactly `["read_file","list_dir"]`.

### EC-2: empty / whitespace-only `tools` → unscoped (NOT deny-all)
- **Affected task:** T1.2
- **Family:** Boundary
- **Scenario:** `tools:` empty or `tools: ,` parses to `[]` → `subagentToolWhitelist` returns `undefined` → `withSubagentToolScope` is passthrough (D3). A typo must not silently brick the sub-agent (deny-all).
- **Suggested test:** `subagentToolWhitelist_empty_is_undefined` (already in T1.2 TDD) — `{tools:[]}` → `undefined`; passthrough verified.

## DOCUMENT

### EC-3: nested `withSubagentToolScope` (a scoped sub-agent that itself scopes a child)
- **Accepted risk:** `withToolWhitelist` documents that nested calls SHADOW the outer set and restore it on return (EC-F in its own contract). So a sub-agent scoped to `["read_file"]` that runs a child scoped to `["list_dir"]` sees `["list_dir"]` inside the child and `["read_file"]` after — the existing AsyncLocalStorage semantics. No action; document that nesting shadows (matches fork behavior).

### EC-4: tool names are EXACT-match (case-sensitive, canonical/post-repair)
- **Accepted risk:** `checkToolWhitelist` is exact `Set.has` — `tools: Read_File` will NOT match the canonical `read_file` and the sub-agent would have everything blocked. This is the same contract as fork's `allowedTools`. Document on `AgentDefinition.tools` that names must match the canonical (post-repair, lowercase) tool names. No action beyond the docstring + docs.md note.

## Summary

| Task | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------|----------|-------------|----------|
| T1.1 | 1 | 0 | EC-1 | EC-4 |
| T1.2 | 2 | 0 | EC-2 | EC-3 |
| T2.1 | 0 | 0 | 0 | 0 |

**Verdict:** PLAN OK (2 SHOULD TEST — parse robustness + empty-unscoped — fold into T1.1/T1.2 TDD; EC-3/EC-4 are docstring notes; no MUST FIX)

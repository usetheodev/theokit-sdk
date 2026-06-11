# Discover Edge Case Review — opencode-clone-theokit v2.0

Date: 2026-06-11
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/opencode-clone-theokit-plan.md (v2.0)
Research questions analyzed: 10
Edge cases found: 3 (MUST FIX: 1, SHOULD TEST: 1, DOCUMENT: 1)

## MUST FIX

### EC-1: Prompt profiles are in `session/prompt/` not `agent/prompt/`
- **Affected question:** Q6
- **Family:** Reference path / Citation
- **Scenario:** Q6 cites `packages/opencode/src/agent/prompt/default.txt` and `agent/prompt/anthropic.txt`. These do NOT exist. The 14 model-specific prompt profiles are at `packages/opencode/src/session/prompt/` (default.txt, anthropic.txt, gpt.txt, gemini.txt, beast.txt, codex.txt, etc.). The `agent/prompt/` directory contains only 4 files: compaction.txt, explore.txt, summary.txt, title.txt (utility prompts, not model profiles).
- **Impact:** Q6 investigation reads wrong directory. Blueprint section on prompt profiles will be incomplete.
- **Suggested fix:** Change Q6 sources to `session/prompt/default.txt` and `session/prompt/anthropic.txt`. Note that `agent/prompt/` has utility prompts (compaction, summary) which should be investigated in Q3 (session lifecycle).

## SHOULD TEST

### EC-2: Q2 (20 tools) is the largest question — risk of context exhaustion
- **Affected question:** Q2
- **Suggested halt-loop checkpoint:** After reading the first 5 tools (read, write, edit, glob, grep), emit an intermediate 5-row matrix and checkpoint. Then continue with the next 5 (shell, webfetch, websearch, task, question). Then the last 10 (todo, plan, skill, lsp, apply_patch, mcp-websearch, truncate, truncation-dir, external-directory, invalid). 3 sub-checkpoints prevent context loss.

## DOCUMENT

### EC-3: OpenCode uses Effect-TS pervasively — code patterns may be hard to map to vanilla TS
- **Accepted risk:** OpenCode's `agent.ts`, `session.ts`, and tool files use Effect-TS generators (`Effect.gen`), pipes, and layers instead of async/await. The discovery executor must understand Effect patterns to trace the flow. Per ADR A3, TheoCode will use vanilla TS — the blueprint should map Effect patterns to async/await equivalents. This is an interpretation challenge, not a path/method issue. Acceptable because: (a) Effect patterns are well-documented, (b) the core logic (tool dispatch, retry, streaming) is the same regardless of effect system.

## Summary

| Question | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------------|----------|-------------|----------|
| Q1 | 0 | 0 | 0 | 0 |
| Q2 | 1 | 0 | 1 (EC-2) | 0 |
| Q3 | 0 | 0 | 0 | 0 |
| Q4 | 0 | 0 | 0 | 0 |
| Q5 | 0 | 0 | 0 | 0 |
| Q6 | 1 | 1 (EC-1) | 0 | 0 |
| Q7 | 0 | 0 | 0 | 0 |
| Q8 | 0 | 0 | 0 | 0 |
| Q9 | 0 | 0 | 0 | 0 |
| Q10 | 0 | 0 | 0 | 0 |
| All | 1 | 0 | 0 | 1 (EC-3) |

**Verdict:** DISCOVERY PLAN NEEDS ADJUSTMENT — 1 MUST FIX: prompt profiles path `agent/prompt/` → `session/prompt/`.

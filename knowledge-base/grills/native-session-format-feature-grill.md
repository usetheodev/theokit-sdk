---
slug: native-session-format
generated_by: roadmap-feature
milestone_id: SE40
date: 2026-07-15
status: completed
---

# Feature grill — Native Claude-shaped session format + --continue (SE40)

## Q1 — What is this feature and why NOW?
Make the theokit NATIVE session persistence BE the Claude Code on-disk shape (uuid/parentUuid DAG +
structured tool_use/tool_result/thinking blocks) at a CONFIGURABLE baseDir (default ~/.theokit, settable
~/.claude), layout projects/<encoded-cwd>/<sessionId>.jsonl — exactly like Claude Code. WRITE + READ so
--continue works (resume our sessions in the Claude CLI + read the CLI's own sessions). VIRADA TOTAL:
remove the minimal {role,content,at} store AND the SE39 ClaudeCodeTranscriptWriter (breaking, v4.0). No
"ClaudeCode" naming — theokit format, claudecode-friendly first.
**Why now:** the owner reviewed SE39 (3.8.0) and rejected the bolt-on exporter — the requirement was a
NATIVE format switch + configurable dir enabling real --continue, not a side channel.

## Q2 — Dependencies?
SE39 [x] — reuse its mapper (steps→claude records), the onStep toolResult fix, secret redaction, and the
real-claude-code-log-parser round-trip gate. SE40 supersedes SE39's exporter approach.

## Q3 — Definition of Done?
Native FS ConversationStorage = claude-shaped record + layout, baseDir configurable; minimal store +
ClaudeCodeTranscriptWriter REMOVED (no ClaudeCode* symbol); WRITE rich records (blocks + ids + thinking
signature); READ/--continue (walk parentUuid DAG → rebuild history → resume; read real ~/.claude
sessions); COMPACTION emits a compact_boundary + summary into the DAG, replayed on resume; edge cases
(subagent agent-*.jsonl, fork/child, dedup, thinking-signature #63147, migration from old messages.jsonl);
round-trip through the real parser + real-LLM write→read→continue. Full DoD in ROADMAP.md § SE40.

## Q4 — Top NEW risks?
1. Format instability becomes a NATIVE dependency (Anthropic: internal, changes between versions) — could
   break --continue + reading real ~/.claude sessions. Mitigation: pin version; round-trip gate on write;
   version-detect on read; default ~/.theokit (isolated) so drift only affects the ~/.claude opt-in mode.
2. Compaction vs append-only DAG is subtle — summarizing must not orphan the parentUuid chain + must be
   resume-correct. Mitigation: compact_boundary record + synthetic summary node, replayed on resume
   (mirror Claude Code), with dedicated tests.
3. Breaking on-disk migration (location + shape change) — v4.0 major + documented/one-shot old→new import.

## Out-of-scope cross-check
Ran against "Subprocess / CLI-wrapper model" veto. FALSE-POSITIVE: that item vetoes the EXECUTION model
(subprocess vs in-process product shape), NOT the session FORMAT. Adopting the .jsonl format keeps the
in-process, BYO-tools runtime — the owner consciously chose format-compatibility ("claudecode-friendly
first") while preserving the in-process runtime model. out_of_scope_overlap: false_positive.

## SOTA delta
No new peers — SE39's clones (claude-code-log, claude-code-transcripts, claude-code-jsonl-parser) already
cover the format + the DAG-reconstruction / resume mechanics (claude-code-log dag.py). a peer project/codex
peers deferred with their adapters.

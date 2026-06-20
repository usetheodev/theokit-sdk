---
"@theokit/sdk-tools": minor
---

M3-2 — catastrophic-command guardrail for `shell_exec` (secure by default; plan `m3-catastrophic-shell`).

`createShellTool()` now screens every command against a segment-aware deny-list **by default**. A command that, in any segment (across `;`/`&&`/`||`/pipe chains, behind `sudo`/`env`, or piped into a shell), matches a catastrophic pattern returns `{ ok: false, error: "catastrophic_command", reason }` instead of executing. The screened set: `rm -rf` of a root/home/glob target (relative paths like `./build` stay allowed), `curl`/`wget` piped into `sh`/`bash`, `mkfs`, `dd` writing to a device, the `:(){ :|:& };:` fork bomb, `git push --force` (`--force-with-lease` allowed), `chmod -R` on a root path, and redirects to a block device. Matching is at COMMAND POSITION (the executable, not an arbitrary substring), so a mention like `echo "rm -rf /"` is not over-blocked.

**Behavior change:** agents running catastrophic commands now get `catastrophic_command`. Opt out for legitimate destructive power flows with `createShellTool({ allowCatastrophic: true })`.

This is a heuristic GUARDRAIL, not a sandbox — it is bypassable by obfuscation and is POSIX-only (Windows PowerShell out of scope). Also exports the reusable primitives `catastrophicShellReason` and `CatastrophicCommandError`. Zero new dependencies (in-house segment tokenizer).

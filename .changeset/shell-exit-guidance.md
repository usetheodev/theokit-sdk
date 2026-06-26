---
"@theokit/sdk-tools": minor
---

Add `withShellExitGuidance` — a guidance wrapper for `shell_exec` soft failures.

`injectGuidance`/`withDefaultGuidance` inject an actionable `guidance` hint only on `{ ok:false, error }` results (by design). But `shell_exec` returns `{ ok:true, exit_code }` — a non-zero `exit_code` is a SOFT failure (the tool ran, the command failed) that the ok:false-only injector does not cover. `withShellExitGuidance(tool)` wraps `shell_exec` so a `{ ok:true, exit_code≠0 }` result gains a `guidance` hint ("The command exited N. Read the stderr above, fix the cause, then retry."). ADDITIVE, IDEMPOTENT, NEVER-THROW; a no-op for any other tool, for `exit_code 0`, and for non-JSON output. Composes after `withDefaultGuidance` (disjoint domains — no double-injection). Lets consumers drop app-side shell-exit guidance reimplementations.

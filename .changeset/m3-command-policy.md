---
"@theokit/sdk-tools": minor
---

M3-6 — composable command-permission policy layer (plan `m3-command-policy`).

A small, pure, zero-dependency policy layer that builds on the `shell_exec` catastrophic guardrail (M3-2):

- `type CommandPolicy = (command) => string | null` — a deny reason, or `null` to allow.
- `denyCatastrophicCommands()` — a policy composing `catastrophicShellReason` (no duplicated deny-list).
- `commandDenialReason(command, policies)` — first deny reason across the array (deny-wins); `null` if all allow; an empty array denies nothing.
- `isCommandAllowed(command, policies)` — the boolean view.

Framework-agnostic — wire it at your permission layer (e.g. inside a `pre_tool_call` hook). Inherits the guardrail's honesty (a heuristic gate, not a sandbox). Zero new dependencies.

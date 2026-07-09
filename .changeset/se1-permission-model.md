---
"@theokit/sdk": minor
---

**SE1 — Permission model: `PermissionMode` + an enriched `canUseTool` gate.**

The existing `PermissionEngine` (rules + arg-matching + fail-closed `ask` default, #55) gains a per-run **`PermissionMode`** (`"default" | "plan" | "acceptEdits" | "bypass"`) — a pure post-processor of the rule verdict (no tool metadata needed, fits bring-your-own-tools):

- `default` — rules decide; unmatched ⇒ `ask` (fail-closed).
- `plan` — read-only: `allow` rules pass, everything else ⇒ `deny`.
- `acceptEdits` — auto-approve the UNMATCHED verdict but still honor an explicit `ask` rule (Codex `UnlessTrusted`).
- `bypass` — everything ⇒ `allow` EXCEPT an explicit `deny` rule (OpenCode `dangerously-skip-permissions` / Codex `Never`).

**Invariant (both OpenCode + Codex):** an explicit `deny` is immune to every auto-approve mode. `bypass`/`acceptEdits` never un-deny.

`createPermissionPlugin` gains `mode` + an enriched async **`canUseTool(toolName, input, ctx)`** gate (the Anthropic-parity shape) that resolves the `ask` verdict to allow/deny — fail-closed on absent/throwing gate. The old `onAsk(toolName)` is kept as a `@deprecated` back-compat fallback.

New exports: `PermissionMode`, `applyMode`, `PermissionGate`, `PermissionGateContext`, `PermissionGateDecision`. Additive + backward-compatible (`evaluate` mode defaults to `default`; `onAsk` still works). `updatedInput` (arg rewrite) is intentionally deferred — the `pre_tool_call` seam is veto-only today.

Grounded in a deep OpenCode + Codex permission-model comparison (SDK Evolution roadmap SE1).

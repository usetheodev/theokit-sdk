---
"@theokit/sdk": minor
---

SE1 — the permission model is now resolved PER RUN. `SendOptions.permissionMode` (per-send) and `AgentOptions.permissionMode` (creation-time default) thread a `PermissionMode` (`default | plan | acceptEdits | bypass`, with `bypassPermissions` as the Anthropic-exact alias of `bypass`) into a registered `PermissionPlugin`'s pre-tool gate, with documented precedence (send > create > plugin construction > `default`). Also: the `canUseTool` gate is now fail-CLOSED on any non-`allow` decision (was fail-open — a malformed/undefined return previously allowed); a `g`/`y`-flag `RegExp` arg matcher is reset before each test (deterministic authorization). Full `PermissionMode` + `canUseTool` surface documented in docs.md.

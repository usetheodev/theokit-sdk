---
"@theokit/sdk": patch
"@theokit/acp": patch
---

Fix a live security defect: the ACP `pre_tool_call` permission veto was never enforced (#68). `installPermissionPlugin` tried to register its veto hook via `pluginManager.register(...)`, but `PluginManager` exposed no `register()` method — only a single-shot `initialize()` that throws when called twice. The call fell through to `void mgr.initialize([plugin])`, whose "called twice" rejection was swallowed, so the permission hook was never aggregated and guarded tools ran **without** the permission check even under `permissionMode: "deny"`/`"ask"`.

`PluginManager` now exposes `register(plugin)` — a post-init, `general`-only registration that REPLACES a same-named plugin's hooks (idempotent for the per-prompt ACP re-install) instead of appending duplicates. Additionally, `installPermissionPlugin` now emits a clear stderr warning instead of silently no-op'ing when a runtime has no plugin manager and the mode is not `auto` (so a `deny` that cannot be enforced is never silent).

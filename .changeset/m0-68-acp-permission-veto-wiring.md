---
"@theokit/sdk": patch
"@theokit/acp": patch
---

Fix a live security defect: the ACP `pre_tool_call` permission veto was never enforced (#68). `installPermissionPlugin` tried to register its veto hook via `pluginManager.register(...)`, but `PluginManager` exposed no `register()` method — only a single-shot `initialize()` that throws when called twice. The call fell through to `void mgr.initialize([plugin])`, whose "called twice" rejection was swallowed, so the permission hook was never aggregated and guarded tools ran **without** the permission check even under `permissionMode: "deny"`/`"ask"`.

`PluginManager` now exposes `register(plugin)` — a post-init, `general`-only registration that REPLACES a same-named plugin's hooks (idempotent for the per-prompt ACP re-install) instead of appending duplicates. Additionally, `installPermissionPlugin` is now **fail-closed**: when the runtime has no plugin manager (e.g. a CloudAgent) and the mode is `deny`/`ask`, it throws a `ConfigurationError` (`code: "permission_enforcement_unavailable"`) and the ACP prompt is refused — rather than letting tools run ungated while the operator believes they are gated. It is also now `async` and awaits registration, so the veto hook is guaranteed aggregated before the first tool dispatch (no fire-and-forget window).

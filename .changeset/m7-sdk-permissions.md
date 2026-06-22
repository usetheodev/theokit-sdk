---
"@theokit/sdk": minor
---

M7 (Tema F) SDK slice — PermissionEngine default-deny + plugin wiring.

- `PermissionEngine` now takes `{ defaultAction }` (default `"allow"`, backward-compatible) — opt into default-deny with `new PermissionEngine(rules, { defaultAction: "deny" })`. `PermissionAction`/`PermissionRule`/`PermissionEngineOptions` types are now exported.
- New `createPermissionPlugin(engine, opts?)` wires a `PermissionEngine` into the `definePlugin` `pre_tool_call` veto (the engine was previously exported-but-unwired): `deny` blocks, `ask` defers to `opts.onAsk` (fail-closed block by default), `allow` passes.

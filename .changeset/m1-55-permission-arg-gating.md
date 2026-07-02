---
"@theokit/sdk": minor
---

`PermissionEngine` now gates on tool **arguments**, not just the tool name, and defaults **fail-closed** (#55). A `PermissionRule` may declare `args?: Record<string, string | RegExp | (value) => boolean>`; `evaluate(toolName, args?)` matches a rule only when the tool name matches AND every declared argument predicate matches the corresponding call argument — so a single `shell` rule can deny `rm -rf` while letting `ls` fall through. A missing/undefined argument fails its predicate (the rule does not match; it never throws). Name-only rules are unchanged. `createPermissionPlugin(engine)` now forwards the tool arguments into `evaluate`, so argument-level gating works through the `pre_tool_call` flow automatically.

**BREAKING (behavior):** the action returned when NO rule matches is now `"ask"` (fail-closed), changed from the previous `"allow"` (fail-open). A permission engine that cannot positively allow must not silently allow. If you relied on the fail-open default, restore it explicitly with `new PermissionEngine(rules, { defaultAction: "allow" })`.

---
"@theokit/sdk": minor
---

`ctx.on(...)` now returns a disposer, so a plugin can detach one hook.

It returned `void`, which made the plugin Observer a one-way door: a handler attached through
`initialize()` had no removal path and ran for the life of the process. The only documented dynamic
case — a permission plugin re-installed on every prompt — worked because the registry keys plugins by
name, so re-registering the whole plugin was the only way to remove one hook.

```ts
const off = ctx.on("pre_tool_call", handler);
// ...later
off();
```

The disposer detaches the registration it was given — attaching the same function twice and disposing
once leaves one — and is idempotent. A handler the SDK refused (a non-function, which is warned and
ignored) still returns a working no-op disposer, so a caller never has to branch on whether the
registration took.

Two observers in the SDK already worked this way (`Run.onDidChangeStatus`, `MessageBus.unregister`);
this closes the gap. The new `PluginHookDisposer` type is exported.

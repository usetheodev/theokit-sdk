---
"@theokit/sdk": patch
---

The README explains that three unrelated things in this ecosystem are called "plugin", and that
two of them share one option.

A **framework plugin** (`@theokit/plugin-canvas`, `@theokit/auth-github`, …) extends a `theokit`
application — routes, UI, devtools, CLI verbs. An **SDK code plugin** (`PermissionPlugin.create(…)`,
`Handoff.asPlugin(…)`) extends an agent and is passed as `Agent.create({ plugins: [ … ] })`. The
same option also accepts `{ enabled: ["name"] }`, which selects **file-discovered** plugins under
`.theokit/plugins/` and is mutually exclusive with the array form.

Reaching for the wrong one raises no error; it simply has no effect. Installing `plugin-payments`
does nothing for an agent, and passing `PermissionPlugin` does nothing for a route.

It also records the observation that sends people looking for a bug that is not there:
`agent.pluginsManager` only ever holds the file-discovered form, so it reports `plugins: []` while
a code plugin is registered and working. An empty manager beside a populated `options.plugins` is
the normal shape.

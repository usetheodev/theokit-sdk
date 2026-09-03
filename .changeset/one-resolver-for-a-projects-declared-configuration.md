---
"@theokit/sdk": patch
---

One resolver now answers "where does this project's configuration live?" — `theokitConfigRoot(cwd)`,
in `internal/persistence/paths.ts`, semver-exempt.

Five readers hand-rolled `join(cwd, ".theokit", ...)` independently: `mcp.json`, the context
directory + `context.json`, the hooks-root fallback check, `registry.json`, and the personality
`PROJECT_SUBDIR`. `projectConfigRoots` (hooks/skills/subagents/plugins, per usetheokit/theokit-sdk#524)
already resolved its native root the same way, inline, making six independent copies of one
constant.

No filename, format or resulting path changes — this is a pure consolidation, and the project's own
lint gate (`no-hardcoded-theokit-path.test.ts`, ratcheted 23 → 14) is the proof: every literal this
change removed was already flagged as migration debt, and the full suite is unchanged.

Deliberately does NOT touch homedir-anchored state (sessions, credentials, the personality
`USER_SUBDIR`, provider discovery) — those follow `getTheokitHome`/`THEOKIT_HOME` by design, and
folding them into this resolver would be the exact silent behaviour change
`theokitConfigRoot`'s own docblock warns against: a project's committed configuration must never
follow an operator's relocated state directory. A regression test pins this — swapping the
resolver's body for `getTheokitHome`'s would move all six readers under `THEOKIT_HOME` at once, in
one line, with no caller-side signal.

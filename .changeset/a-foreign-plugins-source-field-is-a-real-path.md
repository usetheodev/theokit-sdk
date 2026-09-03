---
"@theokit/sdk": patch
---

A foreign plugin's `source` field is now a real relative path instead of a single character.

Both manifest loaders (Claude Code's `.claude-plugin/plugin.json` form and this SDK's own
`PLUGIN.md`/`plugin.json`) built `source` by searching the manifest path for the literal substring
`.theokit/` and slicing from there. A manifest read from `.claude/plugins/<name>/…` contains no such
substring: `indexOf` returns `-1`, and `.slice(-1)` silently returned the manifest path's LAST
CHARACTER — `"n"` from `.json`, `"d"` from `PLUGIN.md` — instead of a path.

`source` is exactly the audit trail the visibility half of usetheokit/theokit-sdk#524 exists to
provide, and this was broken for precisely the case that matters most: a plugin admitted from a
foreign root. Replaced the substring search with `path.relative(cwd, manifestPath)` — the stdlib
does this correctly, and it is what the substring search was trying to approximate.

Found alongside the entry-file root confusion, testing the same per-surface admission work.

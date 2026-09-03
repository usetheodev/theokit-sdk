---
"@theokit/sdk": minor
---

A project can now declare its foreign compat sources in `.theokit/config.json`, instead of only in
code.

```json
{
  "compat": {
    "adapters": [{ "kind": "claude-code", "import": ["skills", "subagents"] }]
  }
}
```

The DECLARATIVE half usetheokit/theokit-sdk#524 asked for, in a `## Sketch` written against TOML.
It ships as JSON: this SDK already reads JSON everywhere a project declares something
(`settings.json`, `mcp.json`, `context.json`) and carries no TOML parser or dependency for one —
adding one for a single optional section would be the opposite of what #522/#524 are about, reading
in a new format nobody asked this SDK to speak. The shape is unchanged: `compat.adapters` accepts
exactly what `local.compatSources` already does in code — a bare kind string, or `{ kind, import }`.

**Precedence, decided here because the issue does not state it:** explicit `local.compatSources` in
code wins over the file. The file is the default for a caller who declared nothing. A test or a
one-off script can therefore always override the file without editing or deleting it.

Read with `readFileSync`, not this package's usual async reader: the caller is `Agent`'s
synchronous constructor, which resolves `compatSources` before any submanager exists to await a
promise. `existsSync` already runs in the same constructor for the same reason.

One resolver, `resolveCompatSources(options, cwd)`, replaces five call sites that each wrote
`options.local?.compatSources ?? []` by hand — the same duplication `theokitConfigRoot` closed one
layer down, closed here one layer up, so the file form reaches all four surfaces (hooks, skills,
plugins, subagents) through the one place rather than needing five separate edits that could drift.

Closes the declarative half of #524. `#524` itself stays open until it is verified in an installed
release, per this project's issue-lifecycle convention.

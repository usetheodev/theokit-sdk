---
"@theokit/sdk": minor
---

A foreign configuration source can now be admitted to some surfaces and not others.

`compatSources: ["claude-code"]` was all-or-nothing: declaring it admitted `.claude/` to hooks,
plugins, skills AND subagents at once. The four carry very different risk — a skill is text that
enters the system prompt, a plugin is code loading, a hook is command execution — so a consumer who
wanted to reuse the skills they had already written was handed arbitrary command execution along
with them, and had no way to say otherwise.

```ts
local: {
  compatSources: [{ kind: "claude-code", import: ["skills", "subagents"] }],
}
```

Hooks and plugins then resolve `.theokit/` alone. `CompatSurface` and `CompatSourceAdapter` are
exported.

Three rules, each failing closed:

- **The bare `"claude-code"` string still admits every surface.** It is what `5.0.0-next.1`
  published, and narrowing it silently would turn a working opt-in into a no-op that says nothing —
  the defect this option exists to fix, one level up.
- **An adapter with no `import` list admits nothing.** Safe to apply strictly because the object
  form is new and nobody can be relying on it yet.
- **An unrecognised surface name is dropped**, exactly as an unrecognised `kind` already is. A typo
  must narrow access, never widen it.

The `plugins` surface governs reading a foreign plugin directory even when the caller wants the
SKILLS a bundle carries: a bundle is code, and its skills arrive attached to it, so admitting
`skills` alone must not reach inside one. Otherwise the narrower permission would silently grant
the wider one.

Closes the per-surface half of usetheokit/theokit-sdk#524. The visibility half — skills, subagents
and plugins carrying the root they came from, the way hooks already carry `sourcePath` — and the
declarative `.theokit/config.toml` form are not in this change.

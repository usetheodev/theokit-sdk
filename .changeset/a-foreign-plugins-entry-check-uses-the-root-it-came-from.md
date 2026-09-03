---
"@theokit/sdk": patch
---

A foreign plugin's entry file is now checked against the root it was actually discovered under.

`refresh()` iterates every root a compat source admits — `.theokit/plugins`, and `.claude/plugins`
once `compatSources` names the `plugins` surface — and checks each plugin's declared `entry` file
exists. That check reconstructed the plugin's directory as `.theokit/plugins/<folder>`
unconditionally, regardless of which root the plugin was actually found under.

A plugin discovered at `.claude/plugins/my-plugin/` was therefore checked against
`.theokit/plugins/my-plugin/` — a directory it never lived in. With nothing there, a legitimate
foreign plugin was refused as "entry file is missing." Had a same-named folder existed under
`.theokit/plugins/` instead, its entry file would have been read in place of the real one — a path
confusion the ADR D79-D80 traversal guard this check calls does not catch, because the guard runs
against the wrong root rather than against none.

This was reachable through the bare `compatSources: ["claude-code"]` form, which has always admitted
the `plugins` surface — not something the per-surface work landing alongside this introduced.

Found while testing the per-surface admission work for usetheokit/theokit-sdk#524.

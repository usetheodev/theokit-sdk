---
"@theokit/sdk": minor
---

A plugin written for the Claude Code CLI now works instead of merely parsing.

Measured 2026-08-26 against an installed one: a CLI plugin is a BUNDLE — its manifest sits at
`<plugin>/.claude-plugin/plugin.json`, and what it exists to contribute are the `skills/` and
`agents/` directories beside it. This SDK's plugin concept is a JS `entry` point, so such a manifest
already parsed (zod strips the keys it does not know) and then did nothing at all: `name` and
`version` survived while the seven agents and three skills the plugin provides stayed invisible.

The manifest agreeing was never the point. Plugin folders under `.theokit/plugins` and
`.claude/plugins` now contribute their skills and agents, and the CLI's manifest location is read
without the deprecation warning that belongs to this SDK's own superseded `plugin.json` form —
telling someone to migrate a file that is canonical where it came from would be wrong.

Bundles are read AFTER the project's own directories, so a project can shadow a skill or an agent a
plugin ships without editing the plugin.

Project-scoped deliberately. The CLI also keeps plugins under `~/.claude/plugins/cache`, behind its
own installer and enable/disable state; reproducing that is an installation system rather than
reading a project's configuration, and guessing at someone's enablement would run code they had
turned off.

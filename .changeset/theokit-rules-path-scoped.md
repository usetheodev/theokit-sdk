---
"@theokit/sdk": minor
---

Add `.theokit/rules/*.md` — theokit-native path-scoped rule files, mirroring Claude Code's `.claude/rules/`.

Each rule file carries frontmatter with `paths:` (Claude Code parity) and/or `globs:` (Cursor-compatible alias) — both are glob-pattern arrays — plus `alwaysApply` and `enabled`. Rules with `alwaysApply: true` load into the agent's context every send; path-scoped rules activate only when an in-scope file matches, declared per-send via the new `SendOptions.contextPaths`. The same in-scope signal also unblocks conditional activation for `.cursor/rules/*.mdc` globs. No new dependency — glob matching and the YAML-subset parser are shared across both rule formats.

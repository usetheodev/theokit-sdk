---
"@theokit/sdk": minor
---

BREAKING: `npx theokit-init-claude` and the bundled `claude-template/` are gone. The
agent skills they scaffolded now live in [`@theokit/skills`](https://www.npmjs.com/package/@theokit/skills):

```bash
npx @theokit/skills
```

The thirty per-module skills were authored here and copied into that package by a sync
script, so they existed twice and the copy was the worse of the two — the script
stripped YAML frontmatter, and the frontmatter is where the `paths:` globs live that
make a skill load only when you are editing something it covers. They are authored
there now, with the globs intact.

Three things a consumer gets that the old scaffold did not offer. It installs for
every tool rather than Claude Code alone: `.agents/skills/` is read by OpenAI Codex,
Gemini CLI, GitHub Copilot, Zed and Devin Desktop, and `.claude/skills/` by Claude
Code. It links instead of copying when it is a real dependency, so the skills follow
your lockfile rather than freezing at scaffold time. And `--check` fails in CI when
what is installed has drifted, which is the only thing that stops an instruction file
from quietly going stale — a stale one is followed exactly as diligently as a current
one.

The SDK tarball drops 328 KB. Nothing in `dist/` referenced the template; it was
scaffold material, never runtime.

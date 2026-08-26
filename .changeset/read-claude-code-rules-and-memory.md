---
"@theokit/sdk": minor
---

Rules and memories written for the Claude Code CLI are now read.

**Rules** — `.claude/rules/*.md` joins the discovery specs at priority 47. The format needed
nothing: measured over this repository's 32 rule files, none carries frontmatter, and the
`rules-frontmatter` parser already reads a file without it as `alwaysApply: true`. There was simply
no spec pointing at the directory.

47 rather than 46 because B-127 makes these numbers a public contract with room between adjacent
pairs for a consumer's own source. No published priority moves; a consumer that had chosen 47
collides, and that is the cost of an eighth default, recorded here rather than discovered later.

**Memories** — the CLI keeps a project's memories at `<claudeHome>/projects/<encoded-cwd>/memory/`,
the same encoding the transcripts use. `markdown-store`'s own header named that path as the target;
#389 converged the format and the ability to reach the directory was never built, so a memory the
CLI recorded was invisible to an agent working in the same repository. Both stores are read now,
`.theokit` first. `CLAUDE_CONFIG_DIR` names the home when set.

Reading only — writes still go to `.theokit/memory`. Writing elsewhere by default would relocate
every existing consumer's memories, which is the one thing an additive change must not do.

One fidelity fix came with it: a memory's BODY is the fact, and `description` is the one-line recall
aid. This SDK writes both the same, so nothing it wrote changes — but the CLI writes a summary above
the substance, and reading only the summary dropped the fact itself.

---
"@theokit/sdk": patch
---

The Claude Code interop memory read is keyed by the git repository root, matching the CLI.

`claudeProjectMemoryDir` keyed the auto-memory store by `cwd`. The CLI keys it by the repository:
*"the `<project>` path is derived from the git repository, so all worktrees and subdirectories within
the same repo share one auto memory directory. Outside a git repo, the project root is used
instead."*

So an agent running from any directory below the root — a monorepo package, a script in `tools/`, a
test in a subfolder, which is the ordinary case — read a directory the CLI never writes to. It found
nothing and reported nothing, and that observation is identical to an empty store, which is why it
survived the interop change that introduced it.

Confirmed from disk before the fix: of the CLI project directories that resolve to a SUBDIRECTORY of
a git repository, none had a `memory/` at all, while their repository root held three fact files.
The subdirectory directories contained only session transcripts.

**Transcripts are the trap and stay as they were.** The CLI keys those by `cwd`, correctly, and
`encodeProjectDir` is right for them. One encoder serving two axes is what made the two
indistinguishable in the code; the encoder is still shared, the path it is given is not.

`.git` as a FILE — a worktree or a submodule — counts as a repository, so the read does not miss
again in the layout that most needs it.

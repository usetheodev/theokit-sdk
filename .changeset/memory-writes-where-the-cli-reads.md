---
"@theokit/sdk": minor
---

Memories this SDK records can now land where the Claude Code CLI reads them, closing the direction
that was missing: the CLI's memories were already visible here, but everything this SDK wrote went to
`<cwd>/.theokit/memory`, invisible to the CLI in the same project.

`local.sessionDir` is the switch, because it is already the option this project documents for that
interop — point it at `~/.claude` and the CLI can `--continue` a session your agent wrote. A consumer
who set it has said they share state with that CLI, and memory following is what that sentence
already implied. There is no new option, and **nothing moves for anyone who never set it**.

The rule that makes this safe is **write one, read all**. Reads cover the project store, the
configured session home, and the CLI's own default location, so a consumer whose new facts move keeps
every fact they already had. The change relocates where the next one lands; it orphans nothing.

The `MEMORY.md` index is written beside the files it lists rather than in the project store — an
index in one directory naming memories in another points at files that are not there, and that index
is what the CLI reads.

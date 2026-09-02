---
"@theokit/sdk": major
---

**BREAKING:** a project's `.claude/` directory is no longer read unless the consumer declares it.
Pass `local: { compatSources: ["claude-code"] }` to restore today's behaviour.

Four subsystems — hooks, skills, subagents and plugin bundles — resolved `<cwd>/.claude` alongside
`<cwd>/.theokit` with no opt-in anywhere. A directory containing only `.claude/`, and no
configuration of this SDK at all, had its hooks executed, its subagents registered, and its skill
text folded into the system prompt.

**Trust is not consent.** A consumer's trust gate answers "do I trust the code in this directory?",
and it was doing double duty as the answer to a different question: "do I want another product's
configuration imported into this one?" Those come apart in the ordinary case — `.claude/` is
populated in exactly the repository one trusts most, for a different tool, under a different
contract, often by a teammate who never heard of this SDK. The measured cost of conflating them was
the defect fixed one commit earlier: every turn denied by a `PreToolUse` hook nobody had declared.

The skills path is the quieter half. A skill's text enters the system prompt, so importing prompt
content from a directory this SDK does not own is a prompt-injection surface that no consumer opted
into and none could see.

A workspace holding an undeclared `.claude/` now says so once, on the diagnostics channel, naming
the directory and the line that turns it back on. It goes there rather than to stderr because
ignoring an undeclared directory is the intended behaviour, not a failure — every repository that
has Claude Code set up and does *not* want it imported would otherwise pay a line on a TUI host's
render surface for behaving as instructed.

An unrecognised name in `compatSources` is dropped rather than turned into `<cwd>/<name>`: a typo
must fail closed, since a directory name was never enough to describe a dialect.

# `@theokit/sdk` Recipes

## Conversation storage (v4.0)

The pluggable conversation-storage adapters (`ConversationStorageAdapter`,
`FileSystemConversationStorage`, `InMemoryConversationStorage`, and the Postgres / Redis recipes that
extended them) were **removed in v4.0**. There is no swappable storage backend anymore.

A local agent's conversation now **is** a native Claude Code `.jsonl` transcript on disk at
`<baseDir>/projects/<encoded-cwd>/<agentId>.jsonl` — write, read/resume, and append-only compaction
are built in. Configure the root with `local.baseDir` (default `~/.theokit`; set `~/.claude` for
Claude Code CLI `--continue` interop). See:

- `docs.md` § Session persistence — the on-disk format and the resume contract.
- `examples/sessions-basics` — create → send → resume (`--continue`) with recall across a restart.

Multi-host / serverless deploys that previously needed a shared DB backend should mount a shared
`baseDir` (network volume) or replicate the transcript directory; the format is plain JSONL.

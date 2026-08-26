---
"@theokit/sdk": minor
---

The memory store now writes the layout the Claude Code CLI reads.

This SDK's differentiator is that it emits the formats that CLI opens — point `local.sessionDir` at
`~/.claude` and `--continue` a session your agent wrote. Memory did not hold that line: a fact was a
bullet under `## Facts`, so pointing a memory directory at `~/.claude/projects/<project>/memory/`
produced nothing the CLI could read.

Now each memory is its own file with the frontmatter Claude Code writes — `name`, `description`, and
`metadata` carrying `type` and an ISO 8601 `modified` — and `MEMORY.md` is the index that points at
them.

Legacy `## Facts` bullets are still read, so no store loses what it recorded. The brief encoding that
put a fact's kind in a trailing HTML comment never reached a published version, so there is nothing
to migrate from it.

`parseSimpleYaml` also stops flattening nested maps: `metadata:` with indented keys used to yield
`metadata: []` plus the nested keys as top-level entries, so `metadata.type` read as `undefined`
while `type` appeared where it never was.

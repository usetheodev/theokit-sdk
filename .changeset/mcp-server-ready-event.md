---
'@theokit/sdk': minor
---

New `RunEvent` member: `mcp_server_ready`, carrying the server name and the tool names it listed.

`mcp_server_failed` already reached consumers, so a broken MCP server was visible. A server that came
up was not — the resolved tool table never leaves the agent loop's internals, and no event carried an
inventory. A consumer could list what was configured and what broke, and could not tell a server that
came up with twelve tools from one that came up with none.

Emitted from the same function as its failure sibling, on the other branch. An event rather than a
getter because the state is scoped to the run: with `mcpLifecycle: "run"` a server may not exist by
the time anyone asks. Tool names are the server's own, not the sanitized `mcp_<server>_<tool>` form
the model sees.

Requested by `usetheokit/theokit#426`.

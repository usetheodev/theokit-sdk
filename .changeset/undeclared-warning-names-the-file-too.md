---
"@theokit/sdk": patch
---

The undeclared-`.claude/` warning now names the file you can edit, not only the option your host passes

`5.0.1` made this warning reach stderr regardless of any diagnostics sink (#563), which was the
right fix and created a smaller problem underneath it: the message told you to pass
`local: { compatSources: ["claude-code"] }`, and `local` is an argument **the code embedding this
SDK** passes. If you are using a tool built on the SDK rather than calling it yourself, that option
does not exist on your surface — so the line was true about the mechanism and unusable as an action.

Reported by the `theocode` session running `5.0.1` as an embedding host, and their framing is the
one worth keeping: *"correct about the mechanism and misleading about the action — it sends the
person looking for an option that is not on their surface."*

#524 gives the declaration **two entry points for one shape**, and the warning named only one:

| entry point | who can use it |
|---|---|
| `.theokit/config.json` → `{"compat":{"adapters":["claude-code"]}}` | anyone holding the workspace |
| `local: { compatSources: ["claude-code"] }` | whoever embeds the SDK in code |

The message now names the file first, because that is the entry point its reader can reach, and
keeps the code option for the embedder for whom it is the right answer. Nothing about the
behaviour changes — only what the line tells you to do.

## Still open, and worth knowing

There is no way to say *"I know, and I want none"*. `compatSources: []` would be the natural
spelling, but `resolveCompatSources` collapses it into the same `[]` an absent option produces, so
the two cannot be told apart. `theocode` measured one warning per process, and a CLI invocation is
a process — so a shell loop prints one line per iteration. They explicitly did not ask for a change
on the volume; if it starts to matter, threading that distinction through is the shape of the fix.

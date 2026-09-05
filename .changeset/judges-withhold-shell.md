---
"@theokit/sdk": patch
---

The built-in judges no longer hold a `shell` they never asked for (#581)

`internal/scorers/llm-judge.ts` and `internal/judge/judge-call.ts` each create a short-lived agent to
score or adjudicate. Neither wants a tool. One passed no `tools` at all; the other passed `tools: []`.

Neither is enough: **a `shell` tool is always registered on a local agent, including when `tools: []`
is passed.** Withholding is the only mechanism that removes it, and neither judge used it.

The scorer was the worse of the two, because it also carried `sandboxOptions: { enabled: false }` —
which reads like a restriction and is the opposite of one. It does not restrict the shell; it removes
the sandbox around it. So the scorer held an **unsandboxed** shell in `process.cwd()` while reading
content produced by the very thing it was evaluating. `types/agent.ts` § LocalOptions records the
case that already happened to somebody: the working directory held the benchmark's answer key, and
two transcripts show the model citing it.

Both now pass `withheldBuiltinTools: ["shell"]`. The scorer's `sandboxOptions` line is left as it
was: with no shell there is nothing for it to govern, and changing it would be a second, unrelated
decision.

Neither line had a recorded reason — `git log -S` puts both inside large feature commits whose
messages never mention the sandbox, the shell, or a tool surface. If either was deliberate, this
commit and #581 are the trail back.

---
'@theokit/sdk': minor
---

A local agent can now withhold the SDK's builtin tools from the catalog it declares to the model,
and a disabled memory store no longer writes a session transcript into the consumer's repository.

`AgentOptions.withheldBuiltinTools?: readonly BuiltinToolName[]` names builtins — `shell`,
`memory_search`, `memory_get` — that this agent must not declare. Absent or empty, every builtin the
rest of the configuration would register is declared exactly as before, so nothing changes for an
agent that does not ask.

The option exists because denying a tool and never offering it are different things. A consumer
whose sandbox scope cannot admit `shell` could already refuse the call in a `pre_tool_call` hook, and
paid for the tool twice anyway: 267 characters of schema in every request of every round, plus a
round the model can spend discovering a refusal it had no way to anticipate. Withholding removes the
tool from the catalog, so the model is never shown what it cannot have. Withholding also releases the
name — a withheld `shell` may be replaced by a custom tool called `shell` without the
`tool_reserved_name` error, since the reservation exists to prevent a collision that no longer
exists. Builtins still declared stay reserved.

Fixes `usetheokit/theokit-sdk#381`.

`memory: { enabled: false }` now suppresses the per-run session transcript at
`<cwd>/.theokit/memory/sessions/<runId>.md`. It previously did not: that write was gated on the run's
status and nothing else, so an agent with memory switched off still had the full user prompt and
assistant reply written into the working directory — someone else's git repository, in the reported
case. Every other memory surface already honoured the flag, so "memory is off" was true of the
subsystem apart from the one part of it that creates files. Both writers are covered, the legacy
call and the `MemoryProvider.recordSessionSummary` port.

Leaving `memory` unset is unchanged and still writes, because that file is what
`memory_search({ corpus: "sessions" })` reads once memory is switched on; treating an absent config
as off would empty that corpus for consumers who asked for nothing. Writing `enabled: false` is the
opt-out.

So: if you run an agent inside a repository and were adding `.theokit/` to `.gitignore` to keep
prompts and replies out of it, `memory: { enabled: false }` now stops them being written at all.
`memory_search({ corpus: "sessions" })` returns nothing for those runs, which is the trade — no
transcript on disk, nothing to recall from it.

Fixes `usetheokit/theokit-sdk#382`.

---
"@theokit/sdk": minor
---

`StructuredOutputError` distinguishes the causes it already knew apart.

Three different failures reported `no_tool_call`: an agent run that errored
before producing an answer, a run that was cancelled, and a tool-only completion
with no text to structure. Only the free-text message differed, so a caller could
not branch on which had happened without parsing English.

They are now `upstream_run_failed`, `run_cancelled` and `no_text_answer`.
`no_tool_call` keeps its original meaning — the model did not call the forced
output tool — and `parse_failed` is unchanged.

BEHAVIOUR CHANGE for a caller matching `no_tool_call`: three of the five cases it
used to catch now carry their own code. A caller that branched on it for a
cancelled run was branching on a defect, but the string it matched does change.

The union is exported as `StructuredOutputErrorCode`.

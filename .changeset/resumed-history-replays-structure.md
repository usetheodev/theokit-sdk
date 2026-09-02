---
"@theokit/sdk": patch
---

A resumed session now replays its history as structured tool calls instead of flat text, so the
model stops learning to type `[tool call] <name>` as prose.

Hydration has always produced two projections of each stored turn: `text`, in which a tool call
folds to the marker `[tool call] NAME`, and structured `parts`, which carries the call id, the tool
name and the arguments. The replay read `text` alone. So a resumed session showed the model its own
prior turn as prose containing the marker, and the model did the reasonable thing with a pattern it
is shown — it wrote the marker instead of calling the tool. Downstream that surfaced as an assistant
message ending `"…report its output.[tool call] run_shell"` with no tool call behind it: the tool
did not run, nothing errored, and the transcript read as the model narrating an action it never took.

A turn with no `parts` replays exactly as before, so sessions stored by an older SDK keep the
behaviour they were written under. Tool results replay as a user message, which is the convention
the live loop already uses.

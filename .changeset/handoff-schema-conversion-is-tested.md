---
"@theokit/sdk-handoff": patch
---

The schema converter that decides what a model is shown now has tests.

It converts a handoff's input schema into the JSON Schema the model receives, and it had no coverage
at all. A defect there is not a crash — the model is shown the wrong contract, then fails to satisfy
it for reasons no error message explains.

Eleven tests now pin the emitted schema rather than the fact that a call returned: the required and
optional split, nested objects and arrays, enums, the primitive type mapping, and both behaviours for
inputs JSON Schema cannot represent.

That last pair is the wrapper's actual reason to exist, and it was verified against the schema library
rather than taken from the comment describing it: by default an unrepresentable input degrades to an
empty schema instead of throwing, which is the opposite of what the underlying library does on its
own. Callers who ask for the strict behaviour still get the library's own error, message included.

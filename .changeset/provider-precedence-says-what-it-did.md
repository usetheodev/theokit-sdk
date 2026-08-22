---
"@theokit/sdk": patch
---

When the API key's own prefix or an explicit `providers.routes` entry overrides the provider named
in the model id, the SDK now says so once per process, naming both the provider asked for and the
one used.

The precedence itself is unchanged and deliberate: an explicitly-passed key is ground truth about
which endpoint will actually be reached, so a `sk-or-` key beats an `openai/...` prefix. What was
missing was the sentence. A caller writing `model: { id: "custom/model" }` and receiving
`openai API error: auth_failed` had no way to learn their prefix had been overruled, because the
error names only the winner.

Nothing is emitted when the model id carries no prefix, or when the prefix is what was used.

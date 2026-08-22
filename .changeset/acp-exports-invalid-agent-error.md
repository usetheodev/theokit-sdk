---
"@theokit/acp": minor
---

`InvalidAgentError` is now exported from `@theokit/acp`.

It is the single startup failure of `serveAcp` and its documented name, but it was not on the
package's public surface, so a consumer could neither `import` it nor `instanceof` it — leaving
`err.name` string-matching as the only way to tell a bad `agent` from any other rejection. The
package's other named error, `PromptTooLargeError`, was already exported "so that text has a named
origin"; both have the same justification.

---
"@theokit/sdk-memory": minor
---

The declared `@theokit/sdk` floor rises to `>=4.63.0`, because that is what this package now
actually needs.

Replacing its copies with imports from the shared `internal/memory-store` sub-path moved the
requirement: `resolveMemoryRoot`, `sessionsDir`, `writeSessionSummary`, `discoverSessionFiles`,
`discoverWikiFiles`, `persistActiveMemoryTranscript`, `collectMarkdownFiles`, `defaultIndexPath`,
`lanceStoragePath`, `readAllSqliteFacts` and the diary module are all published for the first time
in 4.63.0. Against `>=4.60.0` the install resolves and the imports do not exist.

Found by `dep-check`, which installs the declared floor and runs the suite against it — a gate that
asks what a consumer would actually get rather than what the manifest claims.

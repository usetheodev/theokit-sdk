---
"@theokit/sdk-memory": patch
---

The declared `@theokit/sdk` floor rises to `>=4.63.0`, which is what this package has needed since
it stopped carrying copies.

`resolveMemoryRoot`, `sessionsDir`, `writeSessionSummary`, `discoverSessionFiles`,
`discoverWikiFiles`, `persistActiveMemoryTranscript`, `collectMarkdownFiles`, `defaultIndexPath`,
`lanceStoragePath`, `readAllSqliteFacts` and the diary module all arrived in 4.63.0. Against
`>=4.60.0` the install resolves and the imports do not exist — `dep-check`'s floor leg has been
saying so out loud, correctly, since the de-duplication landed.

It could not be corrected in that release: a package cannot declare a floor that is not published
yet, and 4.63.0 was the version that release created. `onlyUpdatePeerDependentsWhenOutOfRange`
meant changesets would not raise it either, because `>=4.60.0` still admits 4.63.0 and so nothing
looked out of range. The bump had to wait for the version to exist, which it now does.

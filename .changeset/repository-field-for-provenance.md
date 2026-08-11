---
"@theokit/acp": patch
"@theokit/cli": patch
"@theokit/memory-honcho": patch
"@theokit/memory-mem0": patch
"@theokit/memory-supermemory": patch
"@theokit/sdk-pty": patch
---

Declare `repository` so these packages can publish with provenance.

npm cross-checks a manifest's `repository.url` against the repository recorded in the signed
provenance statement, and an empty value cannot match — the PUT is refused with E422 after the
statement has been signed and written to the public transparency log. Six of the twelve publishable
packages carried an empty field; it went unnoticed because nothing needed it until provenance was
enabled, and because each package publishes independently, so the release run went red while the
package everyone was watching succeeded.

`directory` is set alongside the URL, so the registry links to each package rather than to the
repository root.

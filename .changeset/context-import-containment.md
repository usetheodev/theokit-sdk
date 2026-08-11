---
"@theokit/sdk": patch
---

**Security.** Confine `@path` context imports to the repository they are declared in.

`CLAUDE.md` and `GEMINI.md` are discovered by walking up to the git root and carry
`followImports: true`, so their content is repository-controlled. The resolver applied no
root: it handled `~/...` and absolute paths explicitly, so a line that was exactly
`@~/.ssh/id_rsa` in a cloned repository had that file read and inlined into the agent's
system prompt — and from there sent to the model provider. The traversal guard that already
existed (`isSafePattern`) validates the discovery *pattern*, one layer away from the import
*target*, so it never saw this.

`resolveImports` now takes an optional `projectRoot` and refuses a target resolving outside
it, comparing after symlink resolution and forwarding the root through recursion so the
boundary cannot be crossed on a later hop. The discovery runner supplies `gitRoot ?? cwd` —
the same value it already uses to keep absolute paths out of `<source name="">` — and
`runDiscovery` accepts `importRoot` for an embedder whose trust boundary is narrower than
the repository. A refused import becomes `[@import outside the project root, refused: <path>]`
and never the file's bytes; the placeholder echoes the path as written, not as resolved, so
the refusal does not leak the machine's layout back into the same untrusted document.

Callers that pass no root keep the previous behaviour, so this is additive for anyone using
`resolveImports` directly outside the discovery path.

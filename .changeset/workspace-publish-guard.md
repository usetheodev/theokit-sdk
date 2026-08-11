---
"@theokit/acp": patch
"@theokit/cli": patch
"@theokit/memory-honcho": patch
"@theokit/memory-mem0": patch
"@theokit/memory-supermemory": patch
"@theokit/sdk": patch
"@theokit/sdk-budget": patch
"@theokit/sdk-cache": patch
"@theokit/sdk-handoff": patch
"@theokit/sdk-memory": patch
"@theokit/sdk-pty": patch
"@theokit/sdk-tools": patch
---

Refuse a `workspace:` range before it can reach npm.

Five of this repo's twelve publishable packages declare internal dependencies as `workspace:^`, which
is correct on disk and becomes an unrecoverable defect if the publish goes out through a tool that
does not rewrite it: `pnpm` resolves the protocol while packing, `npm` ships the manifest verbatim.
A version published that way fails to install for everyone and cannot be corrected — only
deprecated.

Every publishable package now runs the guard in `prepublishOnly`, so it fires whichever way the
publish is invoked, and `pnpm release` runs it once across the repo before `changeset publish`.

Note for anyone reading a published manifest: the `prepublishOnly` entry points at a path inside
this repository. It never runs for a consumer — the hook only fires when the package itself is
published — and guarding the entry point that a hand-run `npm publish` actually uses was worth the
cosmetic wart of shipping the line.

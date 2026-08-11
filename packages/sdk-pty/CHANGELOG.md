# @theokit/sdk-pty

## 0.3.3

### Patch Changes

- a3ae640: Declare `repository` so these packages can publish with provenance.

  npm cross-checks a manifest's `repository.url` against the repository recorded in the signed
  provenance statement, and an empty value cannot match — the PUT is refused with E422 after the
  statement has been signed and written to the public transparency log. Six of the twelve publishable
  packages carried an empty field; it went unnoticed because nothing needed it until provenance was
  enabled, and because each package publishes independently, so the release run went red while the
  package everyone was watching succeeded.

  `directory` is set alongside the URL, so the registry links to each package rather than to the
  repository root.

## 0.3.2

### Patch Changes

- 8790f70: Refuse a `workspace:` range before it can reach npm.

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

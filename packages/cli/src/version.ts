/**
 * Build-time version constants for @usetheo/cli.
 *
 * `__SDK_VERSION__` is the sibling `@usetheo/sdk` semver (NEVER
 * `workspace:*` — resolved at build time via tsup `define`). Used by
 * `init` templates to pin the SDK dep in scaffolded projects (EC-L
 * fix from edge-case review).
 *
 * `__CLI_VERSION__` is this package's semver. Exposed via `--version`.
 */

declare const __SDK_VERSION__: string;
declare const __CLI_VERSION__: string;

export const SDK_VERSION: string = __SDK_VERSION__;
export const CLI_VERSION: string = __CLI_VERSION__;

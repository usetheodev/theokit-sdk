/**
 * Build-time version constants for @theokit/cli.
 *
 * Both are substituted by tsup `define` at BUILD time, so they are plain string literals in the
 * shipped bundle. The `declare const` below only satisfies the type checker: evaluating this module
 * from unbuilt source, without that substitution, throws a ReferenceError at import.
 *
 * `__SDK_VERSION__` is the sibling `@theokit/sdk` semver (NEVER `workspace:*`). Used by `init`
 * templates to pin the SDK dep in scaffolded projects (EC-L fix from edge-case review).
 *
 * `__CLI_VERSION__` is this package's semver. Exposed via `--version`.
 */

declare const __SDK_VERSION__: string;
declare const __CLI_VERSION__: string;

/**
 * The `@theokit/sdk` semver this CLI was BUILT against — a concrete version, never `workspace:*`.
 *
 * `theokit init` writes it into the scaffolded `package.json`, so it is what a new project pins. It
 * is not a claim about the SDK the current process has loaded, which may be a different version
 * entirely.
 */
export const SDK_VERSION: string = __SDK_VERSION__;
/**
 * This package's semver, substituted at build time — what `theokit --version` prints.
 *
 * Distinct from {@link SDK_VERSION}, which is the `@theokit/sdk` version this CLI was built against
 * and the one `theokit init` writes into a scaffolded `package.json`. They move independently, so a
 * bug report should quote both.
 */
export const CLI_VERSION: string = __CLI_VERSION__;

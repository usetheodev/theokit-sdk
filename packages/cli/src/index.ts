/**
 * @theokit/cli — developer CLI for @theokit/sdk (Adoption Roadmap #1).
 *
 * Subcommands at v1: `init`, `dev`, `inspect`, `eval`.
 *
 * Programmatic entry: `main(argv)` returns the exit code. The
 * `bin/theokit.ts` shim calls this with `process.argv` and exits with
 * the resolved code.
 *
 * @public
 */

export { main } from "./main.js";
export { CLI_VERSION, SDK_VERSION } from "./version.js";

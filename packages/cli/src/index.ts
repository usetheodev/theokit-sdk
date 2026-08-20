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

/**
 * The `eval.config.{ts,mjs}` contract. The README's example ends in
 * `satisfies EvalConfig`, and a user authoring a config file is meant to type it
 * — so the type is part of this package's public surface whether or not it was
 * named here. It was not, so `import type { EvalConfig } from "@theokit/cli"`
 * failed on the documented happy path.
 *
 * The companions travel with it: a config declares `dataset` entries and writes
 * `scorers`, so authoring one against `EvalConfig` alone still leaves those two
 * unnameable.
 */
export type { DatasetEntry, EvalConfig, Score, Scorer } from "./eval/types.js";
export { main } from "./main.js";
export { CLI_VERSION, SDK_VERSION } from "./version.js";

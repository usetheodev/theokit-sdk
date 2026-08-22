/**
 * `@theokit/cli` — the `theokit` developer CLI for `@theokit/sdk` (Adoption Roadmap #1).
 *
 * Normally used as a binary: `npx theokit <subcommand>`. Subcommands: `init`, `dev`, `inspect`,
 * `eval`, `acp`, `setup`, `db`, `tasks`. Run `theokit --help` for the authoritative list — it is
 * generated from the same registration this package ships.
 *
 * The importable surface is deliberately small:
 * - {@link main} — the dispatcher, for embedding the CLI in another process.
 * - {@link EvalConfig} and friends — the types you write `eval.config.ts` against.
 * - {@link CLI_VERSION} / {@link SDK_VERSION} — build-time version constants.
 *
 * `@theokit/acp` is an OPTIONAL peer: only `theokit acp` needs it, and its absence is reported at
 * that point, not at import time.
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

#!/usr/bin/env node
/**
 * `theokit` executable shim. Imports `main` from the package and
 * forwards `process.argv`, then exits with the resolved code.
 *
 * This is the ONE place that calls `process.exit`; `main` itself only returns a code. An error that
 * escapes `main` is printed as `theokit: unhandled error — <message>` and exits 1.
 *
 * Because it exits rather than returning, stdout is not guaranteed to have drained — the standard
 * Node caveat for large output written to a PIPE (`theokit inspect --json`, `theokit tasks list
 * --json`). Prefer `--output`-style flags or a file redirect over a pipe for big payloads.
 *
 * The shebang above is preserved by tsup's banner config; a
 * `chmod +x` is applied post-build via `prepare` script so the
 * file is directly executable in published installs.
 *
 * @internal
 */

import { main } from "../main.js";

main(process.argv)
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `theokit: unhandled error — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });

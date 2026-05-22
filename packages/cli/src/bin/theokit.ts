#!/usr/bin/env node
/**
 * `theokit` executable shim. Imports `main` from the package and
 * forwards `process.argv`, then exits with the resolved code.
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

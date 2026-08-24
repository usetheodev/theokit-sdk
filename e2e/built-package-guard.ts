import { existsSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * Refuses to run when `@theokit/sdk` does not resolve to its built output.
 *
 * The whole point of this suite is to exercise what a consumer installs. Resolving to the
 * source tree instead would still go green while proving nothing about packaging — a
 * silent downgrade, which is worse than a failure because it reads as coverage.
 */
export function assertBuiltPackageResolves(): string {
  const require = createRequire(import.meta.url);
  let entry: string;
  try {
    entry = require.resolve("@theokit/sdk");
  } catch (cause) {
    throw new Error(
      "@theokit/sdk does not resolve from the repository root. Run `pnpm install`, then " +
        "`pnpm build --filter=@theokit/sdk`.",
      { cause },
    );
  }
  if (!entry.includes("/dist/")) {
    throw new Error(
      `@theokit/sdk resolved to ${entry}, which is not a built artifact. This suite must ` +
        "consume the package a consumer installs; refusing to run against source.",
    );
  }
  if (!existsSync(entry)) {
    throw new Error(
      `@theokit/sdk resolves to ${entry}, but that file does not exist — the build is stale.`,
    );
  }
  return entry;
}

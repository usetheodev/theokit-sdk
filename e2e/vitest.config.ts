import { defineConfig } from "vitest/config";

// Root-scoped project. Every other suite in this repository lives under `packages/*`
// and is run by `turbo run test --filter='./packages/*'`; this one deliberately does not,
// because it must resolve `@theokit/sdk` the way an external consumer does — through the
// package `exports` map — rather than through a relative path into the source tree.
export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.test.ts"],
    // Each file owns a server on an ephemeral port, so files may run in parallel;
    // within a file the suite is sequential.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

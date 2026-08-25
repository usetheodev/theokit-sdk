import { defineConfig } from "vitest/config";

// Root-scoped project, like `e2e/`. The gates in `tools/` are not part of any published package —
// `turbo run test --filter='./packages/*'` cannot reach them — so until this config existed a gate
// could only be exercised by running the release it guards. A gate nobody can test is a gate nobody
// can trust to fail correctly, which is the whole of its job.
export default defineConfig({
  test: {
    include: ["tools/tests/**/*.test.mts"],
  },
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

/**
 * A suite the repository's own commands never reach is a silent gate: it reports absence it
 * never checked. `pnpm test` is scoped `--filter='./packages/*'`, and this suite deliberately
 * lives outside `packages/`, so the only thing keeping it reachable is an explicit chain in
 * the root scripts. These assertions exist so unhooking it turns something red.
 */
it("the root `test` script reaches this suite", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as {
    scripts: Record<string, string>;
  };

  expect(pkg.scripts.test).toContain("test:e2e");
  expect(pkg.scripts["test:e2e"]).toContain("e2e/vitest.config.ts");
});

it("the root `typecheck` script reaches this suite", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as {
    scripts: Record<string, string>;
  };

  expect(pkg.scripts.typecheck).toContain("typecheck:e2e");
  expect(pkg.scripts["typecheck:e2e"]).toContain("e2e/tsconfig.json");
});

it("CI runs this suite, and not as a step allowed to fail", () => {
  const workflow = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf-8");

  expect(workflow).toContain("pnpm run test:e2e");
  const stepIndex = workflow.indexOf("pnpm run test:e2e");
  const following = workflow.slice(stepIndex, stepIndex + 200);
  expect(following).not.toContain("continue-on-error");
});

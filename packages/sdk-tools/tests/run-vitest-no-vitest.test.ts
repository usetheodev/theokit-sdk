import { expect, it } from "vitest";
import { formatVitestResult } from "../src/run-vitest.js";

/*
 * #347 — the documented `no_vitest` failure never fired for a project without vitest.
 *
 * `npx` itself starts, writes its complaint to stderr and exits non-zero, leaving nothing on
 * stdout. That reached `unparseable_output`, which reads as "vitest ran and printed something I
 * could not parse" — so an agent chases a reporter or parser problem instead of installing a
 * dependency. `no_vitest` was reachable only when the `npx` BINARY could not be spawned.
 *
 * Measured on the reported repro:
 *   npm error npx canceled due to missing packages and no YES option: ["vitest@4.1.11"]
 */

const TIMEOUT = 30_000;
const failed = (stderr: string) =>
  JSON.parse(formatVitestResult({ kind: "ok", stdout: "", stderr, exitCode: 1 }, TIMEOUT));

it("reports no_vitest when npx says the package is missing", () => {
  const out = failed(
    'npm error npx canceled due to missing packages and no YES option: ["vitest@4.1.11"]\n',
  );

  expect(out.error).toBe("no_vitest");
});

it("reports no_vitest for the other shapes npm uses to say the same thing", () => {
  expect(failed("npm ERR! could not determine executable to run\n").error).toBe("no_vitest");
  expect(failed("sh: 1: vitest: not found\n").error).toBe("no_vitest");
});

it("still reports unparseable_output when vitest ran and produced no JSON", () => {
  // The accepted case (`testing.md` § 4.2). A classifier that answered `no_vitest` for every
  // unparseable run would satisfy the tests above while sending someone to install a dependency
  // that is already installed — the same misdiagnosis, pointing the other way.
  const out = failed("Vitest crashed while running the suite\n  at Object.<anonymous>\n");

  expect(out.error).toBe("unparseable_output");
  expect(out.stderrPreview).toContain("Vitest crashed");
});

it("still reports a parsed summary and the spawn failure unchanged", () => {
  const ok = JSON.parse(
    formatVitestResult(
      { kind: "ok", stdout: '{"numTotalTests":3,"numPassedTests":3}', stderr: "", exitCode: 0 },
      TIMEOUT,
    ),
  );
  expect(ok).toMatchObject({ ok: true });

  const spawnFailed = JSON.parse(
    formatVitestResult({ kind: "spawn_error", message: "ENOENT npx" }, TIMEOUT),
  );
  expect(spawnFailed).toMatchObject({ ok: false, error: "no_vitest" });
});

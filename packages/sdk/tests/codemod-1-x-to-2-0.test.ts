/**
 * SDK 2.0 migration codemod tests (Phase 8 / T8.1; plan v1.1 EC-3 + EC-4).
 *
 * Strategy: copy before/<name>.ts to tmp, invoke jscodeshift with the
 * transformer, diff result byte-equal against after/<name>.ts.
 *
 * Fixtures cover:
 *   1. single-cache-import — single-symbol import rewrite
 *   2. mixed-imports — multi-source split + sub-path rewrite + unknown-symbol preservation
 *   3. aliased — `import { X as Y }` alias preserved
 *   4. agent-create-no-budget — EC-3 CODEMOD-WARN comment insertion
 *   5. agent-create-handoffs — EC-4 CODEMOD comment insertion
 *
 * Idempotency test re-runs the codemod against the AFTER fixture and
 * asserts no change (the comments should not duplicate).
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const codemod = resolve(repoRoot, "scripts", "migrations", "1-x-to-2-0.cjs");
const beforeDir = resolve(__dirname, "fixtures", "codemod-1x", "before");
const afterDir = resolve(__dirname, "fixtures", "codemod-1x", "after");

function runCodemod(targetPath: string): { status: number | null; stderr: string } {
  const result = spawnSync(
    "npx",
    [
      "jscodeshift",
      "-t",
      codemod,
      targetPath,
      "--parser=tsx",
      "--extensions=ts",
    ],
    { cwd: repoRoot, encoding: "utf-8", timeout: 30_000 },
  );
  return { status: result.status, stderr: result.stderr ?? "" };
}

function applyAndRead(fixtureName: string, tmpRoot: string): string {
  const target = join(tmpRoot, `${fixtureName}.ts`);
  copyFileSync(join(beforeDir, `${fixtureName}.ts`), target);
  const r = runCodemod(target);
  if (r.status !== 0) {
    throw new Error(`codemod failed for ${fixtureName}: exit ${r.status} | stderr ${r.stderr}`);
  }
  return readFileSync(target, "utf-8");
}

describe("codemod 1.x → 2.0 (Phase 8 / T8.1)", () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "sdk-2-0-codemod-test-"));
  });

  afterAll(() => {
    if (tmpRoot !== undefined) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("test_codemod_rewrites_single_import — Cache → @theokit/sdk-cache", () => {
    const actual = applyAndRead("single-cache-import", tmpRoot);
    const expected = readFileSync(join(afterDir, "single-cache-import.ts"), "utf-8");
    expect(actual).toBe(expected);
  });

  it("test_codemod_splits_mixed_imports — Cache + tools split, unknown preserved", () => {
    const actual = applyAndRead("mixed-imports", tmpRoot);
    const expected = readFileSync(join(afterDir, "mixed-imports.ts"), "utf-8");
    expect(actual).toBe(expected);
  });

  it("test_codemod_preserves_aliases — `Cache as C` retained in new import", () => {
    const actual = applyAndRead("aliased", tmpRoot);
    const expected = readFileSync(join(afterDir, "aliased.ts"), "utf-8");
    expect(actual).toBe(expected);
  });

  it("test_codemod_agent_create_without_budget_inserts_warn_comment (EC-3)", () => {
    const actual = applyAndRead("agent-create-no-budget", tmpRoot);
    const expected = readFileSync(join(afterDir, "agent-create-no-budget.ts"), "utf-8");
    expect(actual).toBe(expected);
    expect(actual).toMatch(/CODEMOD-WARN: SDK 2.0 — Agent\.create no longer auto-creates Budget/);
  });

  it("test_codemod_agent_create_with_handoffs_inserts_comment (EC-4)", () => {
    const actual = applyAndRead("agent-create-handoffs", tmpRoot);
    const expected = readFileSync(join(afterDir, "agent-create-handoffs.ts"), "utf-8");
    expect(actual).toBe(expected);
    expect(actual).toMatch(/CODEMOD: handoffs option removed in 2\.0/);
  });

  it("test_codemod_idempotent — running on already-migrated AFTER fixture is a no-op", () => {
    // Copy after fixture to tmp, re-run codemod, expect no further change.
    const target = join(tmpRoot, "idempotent-check.ts");
    copyFileSync(join(afterDir, "mixed-imports.ts"), target);
    const before = readFileSync(target, "utf-8");
    runCodemod(target);
    const after = readFileSync(target, "utf-8");
    expect(after).toBe(before);
  });

  it("test_codemod_unknown_symbol_warns — symbol not in map preserved + WARN stderr", () => {
    const target = join(tmpRoot, "unknown.ts");
    require("node:fs").writeFileSync(
      target,
      'import { CompletelyUnknownSymbol } from "@theokit/sdk";\nexport { CompletelyUnknownSymbol };\n',
    );
    const r = runCodemod(target);
    expect(r.status).toBe(0);
    const out = readFileSync(target, "utf-8");
    // Unknown symbol preserved in @theokit/sdk.
    expect(out).toContain('from "@theokit/sdk"');
    expect(out).toContain("CompletelyUnknownSymbol");
    // WARN went to stderr.
    expect(r.stderr).toMatch(/CompletelyUnknownSymbol/);
  });

  it("test_codemod_agent_create_with_budget_no_warn (EC-3 negative)", () => {
    const target = join(tmpRoot, "with-budget.ts");
    require("node:fs").writeFileSync(
      target,
      'import { Agent } from "@theokit/sdk";\n' +
        'const budget = null as never;\n' +
        'const a = await Agent.create({ name: "x", model: { id: "openai/gpt-4o-mini" }, budgetTracker: budget });\n' +
        'export { a };\n',
    );
    runCodemod(target);
    const out = readFileSync(target, "utf-8");
    expect(out).not.toContain("CODEMOD-WARN");
  });
});

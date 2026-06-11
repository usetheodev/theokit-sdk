/**
 * Integration test for @theokit/codemod-sdk-2-0.
 *
 * Sets up a scratch directory simulating a downstream consumer
 * project with sample files containing @theokit/sdk references.
 * Runs the codemod with --write --root <scratch> and verifies:
 *   - package.json's name + dep block keys renamed.
 *   - Source imports rewritten.
 *   - Markdown references rewritten.
 *   - Sub-package specifiers (`@theokit/sdk-memory`) untouched.
 *   - Backup .bak files created when --backup flag passed.
 *
 * Also runs dry-run mode to verify it does NOT modify anything.
 */

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CODEMOD = join(__dirname, "..", "bin", "codemod.mjs");

const failures = [];

async function setupScratch() {
  const cwd = await mkdtemp(join(tmpdir(), "codemod-test-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "consumer-app",
        version: "0.1.0",
        dependencies: {
          "@theokit/sdk": "^1.7.0",
          "@theokit/sdk-memory": ">=0.1.0",
        },
        devDependencies: {
          "@theokit/sdk": "^1.7.0",
        },
      },
      null,
      2,
    ),
  );
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(
    join(cwd, "src", "index.ts"),
    `import { Memory } from "@theokit/sdk";\nimport { createInMemoryMarkdownProvider } from "@theokit/sdk-memory";\nexport { Memory };\n`,
  );
  await mkdir(join(cwd, "docs"), { recursive: true });
  await writeFile(
    join(cwd, "docs", "guide.md"),
    `# Guide\n\nWe use \`@theokit/sdk\` for agents and \`@theokit/sdk-memory\` for memory.\n`,
  );
  return cwd;
}

async function teardown(cwd) {
  await rm(cwd, { recursive: true, force: true });
}

async function runCodemod(cwd, extraArgs = []) {
  return spawnSync("node", [CODEMOD, "--root", cwd, ...extraArgs], {
    encoding: "utf8",
    timeout: 30000,
  });
}

// Helpers — absorb conditional branches so per-test cognitive complexity
// stays under biome's limit while keeping assertion intent obvious.
function pushFail(condition, message) {
  if (condition) failures.push(message);
}

function assertContains(text, fragment, label) {
  pushFail(!text.includes(fragment), `${label}: missing "${fragment}"`);
}

function assertAbsent(text, fragment, label) {
  pushFail(text.includes(fragment), `${label}: still contains "${fragment}"`);
}

function assertPkgKeyMoved(pkg, block, expectedValue, label) {
  const deps = pkg[block] ?? {};
  pushFail(
    deps["@theokit/sdk-core"] !== expectedValue,
    `${label}: ${block}[@theokit/sdk-core] !== ${JSON.stringify(expectedValue)}`,
  );
  pushFail(deps["@theokit/sdk"] !== undefined, `${label}: ${block} still has @theokit/sdk key`);
}

async function testDryRunDoesNotModify() {
  const cwd = await setupScratch();
  try {
    const before = await readFile(join(cwd, "src", "index.ts"), "utf8");
    const result = await runCodemod(cwd);
    if (result.status !== 0) {
      failures.push(`dry-run exit: ${result.status}`);
      return;
    }
    const after = await readFile(join(cwd, "src", "index.ts"), "utf8");
    if (before !== after) {
      failures.push("dry-run modified source file");
    }
    const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
    if (pkg.dependencies["@theokit/sdk-core"] !== undefined) {
      failures.push("dry-run modified package.json");
    }
    if (!result.stdout.includes("Mode: DRY-RUN")) {
      failures.push("dry-run output missing 'Mode: DRY-RUN' header");
    }
  } finally {
    await teardown(cwd);
  }
}

async function testWriteMode() {
  const cwd = await setupScratch();
  try {
    const result = await runCodemod(cwd, ["--write"]);
    if (result.status !== 0) {
      failures.push(`write exit: ${result.status}`);
      return;
    }
    // package.json: dep key renamed, sub-package untouched.
    const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
    assertPkgKeyMoved(pkg, "dependencies", "^1.7.0", "write");
    assertPkgKeyMoved(pkg, "devDependencies", "^1.7.0", "write");
    pushFail(
      pkg.dependencies["@theokit/sdk-memory"] !== ">=0.1.0",
      "sub-package @theokit/sdk-memory was touched (should NOT be)",
    );
    // src/index.ts: import rewritten, sub-package import preserved.
    const ts = await readFile(join(cwd, "src", "index.ts"), "utf8");
    assertContains(ts, 'from "@theokit/sdk-core"', "source import");
    assertAbsent(ts, 'from "@theokit/sdk"', "source import");
    assertContains(ts, 'from "@theokit/sdk-memory"', "sub-package import");
    // docs/guide.md: rewritten + sub-package preserved.
    const md = await readFile(join(cwd, "docs", "guide.md"), "utf8");
    assertContains(md, "`@theokit/sdk-core`", "markdown reference");
    assertContains(md, "`@theokit/sdk-memory`", "sub-package markdown");
  } finally {
    await teardown(cwd);
  }
}

async function testBackupMode() {
  const cwd = await setupScratch();
  try {
    const result = await runCodemod(cwd, ["--write", "--backup"]);
    if (result.status !== 0) {
      failures.push(`backup-write exit: ${result.status}`);
      return;
    }
    // .bak files should exist next to modified files.
    let backupPkg;
    try {
      backupPkg = await readFile(join(cwd, "package.json.bak"), "utf8");
    } catch {
      failures.push("package.json.bak NOT created");
      return;
    }
    const parsedBak = JSON.parse(backupPkg);
    if (parsedBak.dependencies["@theokit/sdk"] !== "^1.7.0") {
      failures.push("package.json.bak does not match pre-write content");
    }
    try {
      await readFile(join(cwd, "src", "index.ts.bak"), "utf8");
    } catch {
      failures.push("src/index.ts.bak NOT created");
    }
  } finally {
    await teardown(cwd);
  }
}

async function testEdgeCaseImportShapes() {
  // Hardens the codemod against real-world consumer patterns that
  // the 3 baseline scenarios above didn't exercise:
  //   - Sub-path specifiers (`@theokit/sdk/agent` → `@theokit/sdk-core/agent`)
  //   - peerDependencies + peerDependenciesMeta rewrite
  //   - Single-quoted imports, type-only imports
  //   - Namespace imports, dynamic imports, re-exports
  //   - Sub-package sub-path stays untouched
  //     (`@theokit/sdk-memory/internal/foo` MUST NOT become `-core`)
  const cwd = await mkdtemp(join(tmpdir(), "codemod-edge-test-"));
  try {
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify(
        {
          name: "edge-consumer",
          version: "0.1.0",
          peerDependencies: { "@theokit/sdk": ">=1.7.0" },
          peerDependenciesMeta: { "@theokit/sdk": { optional: false } },
          optionalDependencies: { "@theokit/sdk": "^1.7.0" },
        },
        null,
        2,
      ),
    );
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src", "shapes.ts"),
      [
        // Single-quoted, type-only — common in TS strict codebases.
        `import type { Agent } from '@theokit/sdk';`,
        // Sub-path specifier — rewrite to @theokit/sdk-core/agent.
        `import { defineRoute } from "@theokit/sdk/agent";`,
        // Namespace import.
        `import * as Theo from "@theokit/sdk";`,
        // Re-export.
        `export { Memory } from "@theokit/sdk";`,
        // Dynamic import.
        `const sdk = await import("@theokit/sdk");`,
        // Sub-package sub-path — MUST stay untouched.
        `import { x } from "@theokit/sdk-memory/internal/foo";`,
        // Sub-package bare — MUST stay untouched.
        `import { y } from "@theokit/sdk-budget";`,
        `void [Agent, Theo, sdk, defineRoute, Memory, x, y];`,
      ].join("\n"),
    );
    const result = await runCodemod(cwd, ["--write"]);
    if (result.status !== 0) {
      failures.push(`edge-shapes exit: ${result.status}`);
      return;
    }
    const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
    assertPkgKeyMoved(pkg, "peerDependencies", ">=1.7.0", "edge");
    assertPkgKeyMoved(pkg, "optionalDependencies", "^1.7.0", "edge");
    // peerDependenciesMeta value is an object, so use bespoke checks.
    pushFail(
      pkg.peerDependenciesMeta?.["@theokit/sdk-core"]?.optional !== false,
      "peerDependenciesMeta key NOT renamed",
    );
    pushFail(
      pkg.peerDependenciesMeta?.["@theokit/sdk"] !== undefined,
      "peerDependenciesMeta still has old @theokit/sdk key",
    );
    const ts = await readFile(join(cwd, "src", "shapes.ts"), "utf8");
    const expected = [
      [`import type { Agent } from '@theokit/sdk-core';`, "type-only single-quoted"],
      [`import { defineRoute } from "@theokit/sdk-core/agent";`, "sub-path specifier"],
      [`import * as Theo from "@theokit/sdk-core";`, "namespace import"],
      [`export { Memory } from "@theokit/sdk-core";`, "re-export"],
      [`const sdk = await import("@theokit/sdk-core");`, "dynamic import"],
      [`import { x } from "@theokit/sdk-memory/internal/foo";`, "sub-package sub-path preserved"],
      [`import { y } from "@theokit/sdk-budget";`, "sub-package bare preserved"],
    ];
    for (const [line, label] of expected) {
      assertContains(ts, line, `shape "${label}"`);
    }
    // Negative: no bare `@theokit/sdk` (without -core or -memory etc.) should remain.
    // Strip all sub-packages and assert no bare @theokit/sdk lingers.
    const stripped = ts.replace(/@theokit\/sdk-[a-z-]+/g, "");
    pushFail(
      /@theokit\/sdk(?!-)/.test(stripped),
      "source still contains bare @theokit/sdk after rewrite",
    );
  } finally {
    await teardown(cwd);
  }
}

(async () => {
  await testDryRunDoesNotModify();
  await testWriteMode();
  await testBackupMode();
  await testEdgeCaseImportShapes();
  if (failures.length > 0) {
    console.error("codemod integration test FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("codemod integration test PASSED (4 scenarios).");
})();

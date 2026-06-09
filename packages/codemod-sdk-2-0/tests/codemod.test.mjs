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
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
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
    if (pkg.dependencies["@theokit/sdk-core"] !== "^1.7.0") {
      failures.push(
        `dependencies key not renamed correctly: got ${JSON.stringify(pkg.dependencies)}`,
      );
    }
    if (pkg.dependencies["@theokit/sdk"] !== undefined) {
      failures.push("old @theokit/sdk key not removed from dependencies");
    }
    if (pkg.dependencies["@theokit/sdk-memory"] !== ">=0.1.0") {
      failures.push("sub-package @theokit/sdk-memory was touched (should NOT be)");
    }
    if (pkg.devDependencies["@theokit/sdk-core"] !== "^1.7.0") {
      failures.push("devDependencies key not renamed correctly");
    }
    // src/index.ts: import rewritten, sub-package import preserved.
    const ts = await readFile(join(cwd, "src", "index.ts"), "utf8");
    if (!ts.includes('from "@theokit/sdk-core"')) {
      failures.push("source import not rewritten");
    }
    if (ts.includes('from "@theokit/sdk"')) {
      failures.push("source import still contains bare @theokit/sdk");
    }
    if (!ts.includes('from "@theokit/sdk-memory"')) {
      failures.push("sub-package source import was modified (should NOT be)");
    }
    // docs/guide.md: rewritten + sub-package preserved.
    const md = await readFile(join(cwd, "docs", "guide.md"), "utf8");
    if (!md.includes("`@theokit/sdk-core`")) {
      failures.push("markdown reference not rewritten");
    }
    if (!md.includes("`@theokit/sdk-memory`")) {
      failures.push("sub-package markdown reference was modified (should NOT be)");
    }
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

(async () => {
  await testDryRunDoesNotModify();
  await testWriteMode();
  await testBackupMode();
  if (failures.length > 0) {
    console.error("codemod integration test FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("codemod integration test PASSED (3 scenarios).");
})();

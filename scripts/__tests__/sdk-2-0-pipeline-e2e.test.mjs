/**
 * SDK 2.0 migration pipeline — end-to-end hermetic test (iter 96).
 *
 * Exercises the full operator runbook flow in a temp directory:
 *
 *   1. Set up scratch with a sample @theokit/sdk consumer.
 *   2. Run phase6-rename-write.mjs --write against scratch.
 *      - Verifies package.json + source + docs rewrite produces the
 *        expected post-Phase-6 state.
 *   3. Run phase7-peerdep-bump.mjs --write against scratch.
 *      - Verifies the peerDep version constraint bumps to ^2.0.0.
 *   4. Run sdk-2-0-pre-publish-check.mjs against scratch.
 *      - Verifies the workspace invariants hold post-Phase-6+7.
 *
 * The scratch directory mimics a small workspace with:
 *   - sdk-core renamed candidate package
 *   - A consumer package (depending on @theokit/sdk in peerDependencies)
 *   - A source file importing @theokit/sdk
 *   - A README mentioning @theokit/sdk
 *
 * Iter 96 — true integration test of the migration pipeline.
 *
 * Note: each script hardcodes its REPO_ROOT via
 * `new URL("..", import.meta.url)`. To make them target the scratch
 * dir, we copy each script into <scratch>/scripts/ before invoking,
 * so their walker treats the scratch as the repo root.
 */

import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const PHASE6_WRITE = join(REPO, "scripts", "phase6-rename-write.mjs");
const PHASE7_BUMP = join(REPO, "scripts", "phase7-peerdep-bump.mjs");
const PRE_PUBLISH = join(REPO, "scripts", "sdk-2-0-pre-publish-check.mjs");

const failures = [];

async function setupScratch() {
  const root = await mkdtemp(join(tmpdir(), "sdk-2-0-pipeline-"));

  // The "sdk-core candidate" package — gets renamed from @theokit/sdk
  // to @theokit/sdk-core. Versioned 1.7.0 → will be manually bumped
  // to 2.0.0 between Phase 6 and pre-publish-check.
  const sdkDir = join(root, "packages", "sdk");
  await mkdir(sdkDir, { recursive: true });
  await writeFile(
    join(sdkDir, "package.json"),
    JSON.stringify(
      {
        name: "@theokit/sdk",
        version: "1.7.0",
        description: "fixture: sdk core candidate",
      },
      null,
      2,
    ) + "\n",
  );

  // A consumer package with a peerDep on @theokit/sdk.
  const consumerDir = join(root, "packages", "consumer");
  await mkdir(consumerDir, { recursive: true });
  await writeFile(
    join(consumerDir, "package.json"),
    JSON.stringify(
      {
        name: "@theokit/consumer",
        version: "0.1.0",
        dependencies: {
          "@theokit/sdk": "^1.7.0",
        },
        peerDependencies: {
          "@theokit/sdk": ">=1.7.0",
        },
      },
      null,
      2,
    ) + "\n",
  );
  await mkdir(join(consumerDir, "src"));
  await writeFile(
    join(consumerDir, "src", "main.ts"),
    `import { Agent } from "@theokit/sdk";\nexport { Agent };\n`,
  );
  await writeFile(
    join(consumerDir, "README.md"),
    `# Consumer\n\nDepends on \`@theokit/sdk\`.\n`,
  );

  // Copy each pipeline script into scratch so its hardcoded
  // REPO_ROOT (new URL("..", import.meta.url)) walks from scratch
  // instead of the real repo.
  const scriptsDir = join(root, "scripts");
  await mkdir(scriptsDir);
  await copyFile(PHASE6_WRITE, join(scriptsDir, "phase6.mjs"));
  await copyFile(PHASE7_BUMP, join(scriptsDir, "phase7.mjs"));
  await copyFile(PRE_PUBLISH, join(scriptsDir, "prepub.mjs"));

  return root;
}

async function teardown(root) {
  await rm(root, { recursive: true, force: true });
}

function runScript(scratch, scriptName, args = []) {
  const path = join(scratch, "scripts", scriptName);
  return spawnSync("node", [path, ...args], {
    encoding: "utf8",
    timeout: 30000,
    cwd: scratch,
  });
}

async function bumpSdkVersionTo2 (scratch) {
  // Step 3 of runbook: manual operator bump. Required so the pre-publish
  // check's peer-version-consistency gate sees the matching major.
  const pkgPath = join(scratch, "packages", "sdk", "package.json");
  const raw = await readFile(pkgPath, "utf8");
  const parsed = JSON.parse(raw);
  parsed.version = "2.0.0";
  await writeFile(pkgPath, JSON.stringify(parsed, null, 2) + "\n");
}

async function main() {
  const scratch = await setupScratch();
  try {
    // Step 2 — Phase 6 rename write.
    const phase6 = runScript(scratch, "phase6.mjs", ["--write"]);
    if (phase6.status !== 0) {
      failures.push(`phase6-rename-write exit: ${phase6.status}`);
      return;
    }
    // Verify rename landed.
    const sdkPkg = JSON.parse(
      await readFile(join(scratch, "packages", "sdk", "package.json"), "utf8"),
    );
    if (sdkPkg.name !== "@theokit/sdk-core") {
      failures.push(`sdk package not renamed; name=${sdkPkg.name}`);
    }
    const consumerPkg = JSON.parse(
      await readFile(
        join(scratch, "packages", "consumer", "package.json"),
        "utf8",
      ),
    );
    if (consumerPkg.dependencies["@theokit/sdk-core"] !== "^1.7.0") {
      failures.push(
        `consumer dep not renamed correctly; deps=${JSON.stringify(consumerPkg.dependencies)}`,
      );
    }
    const consumerSrc = await readFile(
      join(scratch, "packages", "consumer", "src", "main.ts"),
      "utf8",
    );
    if (!consumerSrc.includes('from "@theokit/sdk-core"')) {
      failures.push("consumer src/main.ts not rewritten");
    }

    // Step 3 — operator manually bumps sdk version to 2.0.0.
    await bumpSdkVersionTo2(scratch);

    // Step 4 (sort of) — Phase 7 peerDep bump.
    const phase7 = runScript(scratch, "phase7.mjs", ["--write"]);
    if (phase7.status !== 0) {
      failures.push(`phase7-peerdep-bump exit: ${phase7.status}`);
      return;
    }
    const consumerPkgAfter = JSON.parse(
      await readFile(
        join(scratch, "packages", "consumer", "package.json"),
        "utf8",
      ),
    );
    if (consumerPkgAfter.peerDependencies["@theokit/sdk-core"] !== "^2.0.0") {
      failures.push(
        `consumer peer not bumped to ^2.0.0; peer=${JSON.stringify(consumerPkgAfter.peerDependencies)}`,
      );
    }

    // Step 5 — pre-publish check.
    const prepub = runScript(scratch, "prepub.mjs");
    if (prepub.status !== 0) {
      failures.push(
        `pre-publish-check exit: ${prepub.status}\n${prepub.stdout ?? ""}\n${prepub.stderr ?? ""}`,
      );
      return;
    }
    const prepubOut = prepub.stdout ?? "";
    if (!prepubOut.includes("## Result: PASS")) {
      failures.push(
        `pre-publish did not report PASS\n${prepubOut}`,
      );
    }
    if (!prepubOut.includes("@theokit/sdk-core @ 2.0.0")) {
      failures.push(
        `pre-publish did not detect sdk-core @ 2.0.0\n${prepubOut}`,
      );
    }
  } finally {
    await teardown(scratch);
  }

  if (failures.length > 0) {
    console.error("pipeline-e2e test FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(
    "pipeline-e2e test PASSED (Phase 6 → bump → Phase 7 → pre-publish all succeeded).",
  );
}

main().catch((err) => {
  console.error("pipeline-e2e threw:", err);
  process.exit(1);
});

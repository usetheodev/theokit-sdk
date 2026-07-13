// Tests for the examples-workspace pure logic (node:test — no extra deps).
// Run: node --test tools/examples-workspace/

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  discoverExamples,
  isSafeSlug,
  mergeEnv,
  parseEnvFile,
  resolveRunCommand,
  stripAnsi,
} from "./lib.mjs";

test("parseEnvFile ignora comentários, linhas vazias e linhas sem '='", () => {
  const parsed = parseEnvFile(
    ["# comment", "", "OPENROUTER_API_KEY=sk-or-abc", "not a pair", "  # indented comment"].join(
      "\n",
    ),
  );
  assert.deepEqual(parsed, { OPENROUTER_API_KEY: "sk-or-abc" });
});

test("parseEnvFile remove aspas, prefixo export e preserva '=' no valor", () => {
  const parsed = parseEnvFile(
    ['export A="quoted value"', "B='single'", "C=a=b=c", "D=  spaced  "].join("\n"),
  );
  assert.deepEqual(parsed, { A: "quoted value", B: "single", C: "a=b=c", D: "spaced" });
});

test("mergeEnv: overlay posterior vence; valores undefined são descartados", () => {
  const merged = mergeEnv({ A: "base", B: "keep", C: undefined }, { A: "root" }, { A: "example" });
  assert.equal(merged.A, "example");
  assert.equal(merged.B, "keep");
  assert.equal("C" in merged, false);
});

test("stripAnsi remove escapes de cor e cursor", () => {
  assert.equal(
    stripAnsi("\u001B[32mok\u001B[0m plain \u001B[1;31mred\u001B[m [INFO] fica"),
    "ok plain red [INFO] fica",
  );
});

test("isSafeSlug aceita kebab-case e rejeita path traversal", () => {
  assert.equal(isSafeSlug("agent-basics"), true);
  assert.equal(isSafeSlug("workflow-retry"), true);
  assert.equal(isSafeSlug("../etc"), false);
  assert.equal(isSafeSlug("a/b"), false);
  assert.equal(isSafeSlug(""), false);
  assert.equal(isSafeSlug("UPPER"), false);
});

test("resolveRunCommand: run.ts presente → tsx do root; ausente → null", async () => {
  const root = await mkdtemp(join(tmpdir(), "ews-root-"));
  try {
    const withEntry = join(root, "examples", "with-entry");
    const noEntry = join(root, "examples", "no-entry");
    await mkdir(withEntry, { recursive: true });
    await mkdir(noEntry, { recursive: true });
    await writeFile(join(withEntry, "run.ts"), "console.log(1);\n");

    const cmd = resolveRunCommand({ rootDir: root, exampleDir: withEntry, hasRunTs: true });
    assert.equal(cmd.command, join(root, "node_modules", ".bin", "tsx"));
    assert.deepEqual(cmd.args, ["run.ts"]);
    assert.equal(cmd.cwd, withEntry);

    assert.equal(resolveRunCommand({ rootDir: root, exampleDir: noEntry, hasRunTs: false }), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discoverExamples: manifest primeiro, extras alfabéticos, shells sem package.json excluídos", async () => {
  const root = await mkdtemp(join(tmpdir(), "ews-disc-"));
  try {
    const examplesDir = join(root, "examples");
    const make = async (slug, { pkg = true, runTs = true, nm = false, env = false } = {}) => {
      const dir = join(examplesDir, slug);
      await mkdir(dir, { recursive: true });
      if (pkg) await writeFile(join(dir, "package.json"), JSON.stringify({ name: slug }));
      if (runTs) await writeFile(join(dir, "run.ts"), "// entry\n");
      if (nm) await mkdir(join(dir, "node_modules"), { recursive: true });
      if (env) await writeFile(join(dir, ".env"), "K=v\n");
    };

    await make("agent-basics", { nm: true, env: true });
    await make("workflow-basics");
    await make("zz-extra");
    await make("aa-extra", { runTs: false });
    await make("ghost-shell", { pkg: false, runTs: false, nm: true });

    const manifest = {
      examples: [
        {
          slug: "workflow-basics",
          domain: "workflows",
          title: "Run a workflow",
          description: "d1",
        },
        { slug: "agent-basics", domain: "agents", title: "Creating an agent", description: "d2" },
        { slug: "missing-dir", domain: "agents", title: "Gone", description: "d3" },
      ],
    };

    const list = await discoverExamples({ examplesDir, manifest });
    assert.deepEqual(
      list.map((e) => e.slug),
      ["workflow-basics", "agent-basics", "aa-extra", "zz-extra"],
    );

    const agentBasics = list.find((e) => e.slug === "agent-basics");
    assert.equal(agentBasics.inManifest, true);
    assert.equal(agentBasics.title, "Creating an agent");
    assert.equal(agentBasics.domain, "agents");
    assert.equal(agentBasics.installed, true);
    assert.equal(agentBasics.hasEnv, true);
    assert.equal(agentBasics.runnable, true);

    const extra = list.find((e) => e.slug === "aa-extra");
    assert.equal(extra.inManifest, false);
    assert.equal(extra.runnable, false);
    assert.equal(extra.installed, false);
    assert.equal(extra.domain, "extra");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

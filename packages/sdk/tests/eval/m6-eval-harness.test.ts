/**
 * M6 — Integration Validation (Phase 6).
 *
 * Wires the full SWE-bench-style chain on real git + LocalSandbox (no mocks,
 * no LLM): loadJsonl → provisionRepo → agent edit → captureArtifact →
 * verifyGate, plus the durable-persist ↔ loadJsonl roundtrip. This is the
 * "eat your own cooking" gate for the M6 primitives.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Eval, loadJsonl } from "../../src/eval.js";
import { captureArtifact } from "../../src/internal/eval/code-runner.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { provisionRepo } from "../../src/sandbox/provision.js";
import { Scorers } from "../../src/scorers.js";
import type { SDKAgent } from "../../src/types/agent.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

interface Instance {
  readonly instanceId: string;
  readonly repoUrl: string;
  readonly ref: string;
}

describe("M6 eval harness — full chain integration", () => {
  let root: string;
  let source: string;
  let work: string;
  let headSha: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "theo-m6-"));
    source = join(root, "source");
    work = join(root, "work");
    mkdirSync(source);
    mkdirSync(work);
    git(source, "init", "--quiet");
    git(source, "config", "user.email", "t@t.dev");
    git(source, "config", "user.name", "tester");
    // Buggy `add` — the verify-gate fails until the agent fixes it.
    writeFileSync(join(source, "calc.py"), "def add(a, b):\n    return a - b\n");
    git(source, "add", "calc.py");
    git(source, "commit", "--quiet", "-m", "initial (buggy add)");
    headSha = git(source, "rev-parse", "HEAD");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("runs loadJsonl → provisionRepo → fix → captureArtifact → verifyGate end to end", async () => {
    // 1. loadJsonl with a caller-supplied `map` (D3 — schema lives in the consumer).
    const datasetPath = join(root, "dataset.jsonl");
    writeFileSync(
      datasetPath,
      `${JSON.stringify({ instance_id: "calc-1", repo_url: source, ref: headSha })}\n`,
    );
    const instances = loadJsonl<Instance>(datasetPath, {
      map: (raw) => ({
        instanceId: String(raw.instance_id),
        repoUrl: String(raw.repo_url),
        ref: String(raw.ref),
      }),
    });
    expect(instances).toHaveLength(1);
    const instance = instances[0];
    if (instance === undefined) throw new Error("dataset empty");

    const sandbox = new LocalSandbox({ workDir: work });

    // 2. provisionRepo — clone + checkout the instance into an isolated dir.
    const { repoDir } = await provisionRepo(sandbox, {
      repoUrl: instance.repoUrl,
      ref: instance.ref,
      instanceId: instance.instanceId,
    });
    expect(existsSync(join(repoDir, "calc.py"))).toBe(true);

    // `-B`: never read/write `.pyc` so a same-second source edit is always
    // recompiled (avoids stale-bytecode flake; the verify command is caller-owned).
    const verifyCmd = (): string =>
      'python3 -B -c "import calc, sys; sys.exit(0 if calc.add(1, 2) == 3 else 1)"';

    // 3. Sanity: the gate detects the bug BEFORE any fix.
    const preGate = Scorers.verifyGate({
      sandbox,
      repoDir,
      failToPass: ["calc"],
      passToPass: [],
      command: verifyCmd,
    });
    expect((await preGate.score("", undefined)).score).toBe(0);

    // 4. The "agent" applies the fix into the provisioned repo.
    writeFileSync(join(repoDir, "calc.py"), "def add(a, b):\n    return a + b\n");

    // 5. captureArtifact — the patch is non-empty and reverse-applies.
    const artifact = await captureArtifact(sandbox, repoDir);
    expect(artifact.diff).toContain("calc.py");
    expect(artifact.applies).toBe(true);

    // 6. verifyGate — the fixed tree now passes.
    const postGate = Scorers.verifyGate({
      sandbox,
      repoDir,
      failToPass: ["calc"],
      passToPass: [],
      command: verifyCmd,
    });
    const postResult = await postGate.score("", undefined);
    expect(postResult.score, postResult.reason).toBe(1);
  });

  it("persists a durable run that loadJsonl can re-read (write ↔ read roundtrip)", async () => {
    const persistPath = join(root, "runs", "out.jsonl");
    const agent = {
      agentId: "agent-fake",
      send: (input: string) =>
        Promise.resolve({
          wait: () => Promise.resolve({ status: "finished" as const, result: `done-${input}` }),
        }),
    } as unknown as SDKAgent;

    await Eval.create({
      name: "m6-roundtrip",
      dataset: [{ input: "a" }, { input: "b" }],
      scorers: [() => ({ score: 1 })],
      agent,
      concurrency: 1,
    }).run({
      persist: { path: persistPath, key: (r) => r.input },
      classify: (r) => (r.meanScore >= 0.5 ? "pass" : "fail"),
    });

    // The durable file is itself valid JSONL re-loadable via the SDK loader.
    const persisted = loadJsonl<{ input: string; outcome: string; meanScore: number }>(persistPath);
    expect(persisted.map((r) => r.input)).toEqual(["a", "b"]);
    expect(persisted.every((r) => r.outcome === "pass")).toBe(true);
  });
});

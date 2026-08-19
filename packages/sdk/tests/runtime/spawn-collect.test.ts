import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawnAndCollect } from "../../src/internal/runtime/lifecycle/spawn-collect.js";

/**
 * `spawnAndCollect` is the shared spawn wrapper behind the hooks executor and
 * the shell tool. Its failure mode is not a wrong value — it is a leaked child
 * process or a promise that never settles, so these tests drive REAL processes
 * (integration by the catalog's rule: one real boundary) and assert the child
 * is reaped on every exit path.
 *
 * B-039 recorded `spawn-collect-env-policy.test.ts` as the apparent test for
 * this module; it imports `env-policy.js`, a sibling. This is the module's own.
 *
 * Measured before this file existed: `LF:29 LH:22` (75.9%), not zero. The
 * coverage comes indirectly from the hooks suite through the real importers,
 * `hooks-executor.ts` and `shell-tool.ts` — no test drove `spawnAndCollect`
 * directly. The 7 lines never reached were the timeout and spawn-error paths,
 * which is exactly where a leaked child or an unsettled promise would live.
 */
const NODE = process.execPath;

/** Temp dirs created by the reap test, removed after each case. */
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("spawnAndCollect — collection", () => {
  it("collects stdout and reports a zero exit code on success", async () => {
    const result = await spawnAndCollect({
      command: NODE,
      args: ["-e", "process.stdout.write('hello')"],
      cwd: process.cwd(),
    });

    expect(result.stdout).toBe("hello");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.spawnError).toBeUndefined();
  });

  it("keeps stderr separate from stdout", async () => {
    const result = await spawnAndCollect({
      command: NODE,
      args: ["-e", "process.stdout.write('out');process.stderr.write('err')"],
      cwd: process.cwd(),
    });

    expect(result.stdout).toBe("out");
    expect(result.stderr).toBe("err");
  });

  it("concatenates output arriving across multiple chunks", async () => {
    const script = "process.stdout.write('a');setTimeout(()=>process.stdout.write('b'),10)";
    const result = await spawnAndCollect({
      command: NODE,
      args: ["-e", script],
      cwd: process.cwd(),
    });

    expect(result.stdout).toBe("ab");
  });

  it("reports the child's non-zero exit code instead of throwing", async () => {
    const result = await spawnAndCollect({
      command: NODE,
      args: ["-e", "process.exit(3)"],
      cwd: process.cwd(),
    });

    // A failing hook is a result, not an exception — the caller decides.
    expect(result.exitCode).toBe(3);
    expect(result.spawnError).toBeUndefined();
  });

  it("feeds stdin to the child when provided", async () => {
    const script =
      "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(d.toUpperCase()))";
    const result = await spawnAndCollect({
      command: NODE,
      args: ["-e", script],
      cwd: process.cwd(),
      stdin: "piped",
    });

    expect(result.stdout).toBe("PIPED");
    expect(result.exitCode).toBe(0);
  });

  it("runs the child in the requested cwd", async () => {
    const result = await spawnAndCollect({
      command: NODE,
      args: ["-e", "process.stdout.write(process.cwd())"],
      cwd: "/",
    });

    expect(result.stdout).toBe("/");
  });
});

describe("spawnAndCollect — failure paths", () => {
  it("resolves with a spawnError rather than rejecting when the binary is missing", async () => {
    const result = await spawnAndCollect({
      command: "/nonexistent/theokit-no-such-binary",
      cwd: process.cwd(),
    });

    // Rejecting here would force every call site into a try/catch for a case
    // the result type already models.
    expect(result.spawnError).toBeInstanceOf(Error);
    expect(result.exitCode).toBe(-1);
    expect(result.timedOut).toBe(false);
  });

  it("kills a child that overruns the timeout and reports timedOut", async () => {
    const result = await spawnAndCollect({
      command: NODE,
      args: ["-e", "setTimeout(()=>{},60000)"],
      cwd: process.cwd(),
      timeoutMs: 150,
    });

    // The whole point of the timer: without SIGKILL this promise never settles
    // and the child outlives the agent.
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it("preserves output produced before the timeout fired", async () => {
    const script = "process.stdout.write('partial');setTimeout(()=>{},60000)";
    const result = await spawnAndCollect({
      command: NODE,
      args: ["-e", script],
      cwd: process.cwd(),
      timeoutMs: 300,
    });

    expect(result.timedOut).toBe(true);
    expect(result.stdout).toBe("partial");
  });

  it("reports the timeout, not the exit code, when the child exits just after the deadline", async () => {
    const script = "setTimeout(()=>process.exit(0),120)";
    const result = await spawnAndCollect({
      command: NODE,
      args: ["-e", script],
      cwd: process.cwd(),
      timeoutMs: 100,
    });

    // Pins WHICH of the two racers wins: the timer fired first, so the result
    // is the timeout, not the child's own exit. Note this does NOT constrain
    // the `settled` guard itself — removing that guard leaves the observable
    // result identical, because a Promise ignores a second `resolve` by spec.
    // That guard is defensively correct and genuinely untestable from outside.
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it("actually reaps the child on timeout — it stops running, not just reporting", async () => {
    // The `timedOut: true` result is produced by `settle()` whether or not the
    // SIGKILL landed, so asserting the flag alone cannot see a leaked child —
    // which is precisely this module's stated failure mode. The oracle has to
    // be the child's own liveness, observed from outside the process: it
    // appends to a file on a timer, so continued growth after the promise
    // resolved means it outlived its parent's kill.
    const dir = await mkdtemp(join(tmpdir(), "theokit-spawn-reap-"));
    tempDirs.push(dir);
    const marker = join(dir, "alive.log");
    const script = `const fs=require("fs");setInterval(()=>fs.appendFileSync(${JSON.stringify(marker)},"x"),30);`;

    const result = await spawnAndCollect({
      command: NODE,
      args: ["-e", script],
      cwd: process.cwd(),
      timeoutMs: 250,
    });
    expect(result.timedOut).toBe(true);

    // `child.kill()` only SENDS the signal — the promise resolves before the
    // kernel has reaped the process, so a still-scheduled callback can append
    // once more. Settle first, then measure; otherwise this races under load.
    await new Promise((r) => setTimeout(r, 300));
    const sizeAfterKill = (await readFile(marker, "utf8")).length;
    await new Promise((r) => setTimeout(r, 600));
    const sizeLater = (await readFile(marker, "utf8")).length;

    // A live child appends every 30ms, so ~20 more marks would have landed in
    // that window. Equality is only possible if the process is gone.
    expect(sizeLater).toBe(sizeAfterKill);
  });

  it("does not report a timeout for a child that finishes well within it", async () => {
    // § 4.2 — the accepting direction. A timer that fired unconditionally would
    // pass every timeout test above while killing every legitimate hook.
    const result = await spawnAndCollect({
      command: NODE,
      args: ["-e", "process.stdout.write('fast')"],
      cwd: process.cwd(),
      timeoutMs: 30_000,
    });

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("fast");
  });
});

describe("spawnAndCollect — environment", () => {
  it("passes explicit env overrides to the child", async () => {
    const result = await spawnAndCollect({
      command: NODE,
      args: ["-e", "process.stdout.write(process.env.THEOKIT_TEST_VAR ?? 'unset')"],
      cwd: process.cwd(),
      env: { THEOKIT_TEST_VAR: "injected" },
    });

    expect(result.stdout).toBe("injected");
  });

  it("scrubs secret-like parent env by default (#54)", async () => {
    process.env.THEOKIT_SPAWN_TEST_SECRET_KEY = "should-not-leak";
    try {
      const result = await spawnAndCollect({
        command: NODE,
        args: [
          "-e",
          "process.stdout.write(process.env.THEOKIT_SPAWN_TEST_SECRET_KEY ?? 'scrubbed')",
        ],
        cwd: process.cwd(),
      });

      expect(result.stdout).toBe("scrubbed");
    } finally {
      delete process.env.THEOKIT_SPAWN_TEST_SECRET_KEY;
    }
  });

  it("restores full inheritance under the `all` policy", async () => {
    process.env.THEOKIT_SPAWN_TEST_SECRET_KEY = "inherited";
    try {
      const result = await spawnAndCollect({
        command: NODE,
        args: [
          "-e",
          "process.stdout.write(process.env.THEOKIT_SPAWN_TEST_SECRET_KEY ?? 'scrubbed')",
        ],
        cwd: process.cwd(),
        envPolicy: "all",
      });

      expect(result.stdout).toBe("inherited");
    } finally {
      delete process.env.THEOKIT_SPAWN_TEST_SECRET_KEY;
    }
  });

  it("lets an explicit override win over the scrub policy", async () => {
    const result = await spawnAndCollect({
      command: NODE,
      args: ["-e", "process.stdout.write(process.env.THEOKIT_SPAWN_TEST_SECRET_KEY ?? 'scrubbed')"],
      cwd: process.cwd(),
      env: { THEOKIT_SPAWN_TEST_SECRET_KEY: "explicit" },
    });

    expect(result.stdout).toBe("explicit");
  });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawnAndCollect } from "../../src/internal/runtime/lifecycle/spawn-collect.js";
import { pollUntil } from "../helpers/poll-until.js";

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

  // The deadline is generous ON PURPOSE, and it is worth being exact about what that buys. The
  // behaviour under test is "stdout captured before the kill survives the kill" — but the child has
  // to BOOT before it can write, so the deadline is really racing Node's startup. 300ms lost that
  // race under `pnpm -r run test`, where 18 packages run in parallel and this file's own config
  // documents the resulting libuv saturation; the run then observed an empty stdout and reported a
  // defect in the code under test.
  //
  // This WIDENS the window rather than removing the ordering — a real synchronisation is not
  // available through a single `spawnAndCollect` call. What changes is that 3s is outside the
  // variance of process startup while 300ms sat inside it, so the assertion now measures the
  // helper instead of the machine's load. `testTimeout` is 20s, so the case still fits.
  it("preserves output produced before the timeout fired", async () => {
    const script = "process.stdout.write('partial');setTimeout(()=>{},60000)";
    const result = await spawnAndCollect({
      command: NODE,
      args: ["-e", script],
      cwd: process.cwd(),
      timeoutMs: 3000,
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

    // 3s for the same reason as the case above: the oracle is the child's liveness AFTER the kill,
    // which requires the child to have been alive BEFORE it — and at 250ms, under the parallel run,
    // Node had not finished starting, so there was nothing to reap and nothing to observe.
    const result = await spawnAndCollect({
      command: NODE,
      args: ["-e", script],
      cwd: process.cwd(),
      timeoutMs: 3000,
    });
    expect(result.timedOut).toBe(true);

    // `child.kill()` only SENDS the signal — the promise resolves before the kernel has reaped the
    // process, so a still-scheduled callback can append once more. That settle used to be a fixed
    // `setTimeout(300)`, and 300ms stops being enough when the machine is busy: measured
    // 2026-08-20, this test failed once inside a full parallel `turbo run test` and passed 3/3 in
    // isolation and 4/4 under 12-core saturation — the signature of a wall-clock wait, not a defect
    // (rules/testing.md § 6 lists exactly this as an anti-pattern).
    //
    // So wait on the SIGNAL instead: the file stops growing precisely when the child is gone. Two
    // equal reads across a gap longer than the child's own 30ms append interval mean it is dead —
    // a live child cannot produce that. The deadline is a safety net, not the signal, so a passing
    // run is no slower than the sleep it replaces.
    const sizeOf = async (): Promise<number> => (await readFile(marker, "utf8")).length;
    let settled = await sizeOf();
    await pollUntil(
      async () => {
        const before = settled;
        await new Promise((r) => setTimeout(r, 100));
        settled = await sizeOf();
        return settled === before;
      },
      {
        deadlineMs: 10_000,
        intervalMs: 0,
        message: async () => `child still appending after 10s — last size ${await sizeOf()}`,
      },
    );
    const sizeAfterKill = settled;
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

describe("a child that never reads its stdin", () => {
  /**
   * Backport regression for the `EPIPE` half of `667bd3d1`.
   *
   * A hook that only checks the environment, or any command that ends with `exit 1`, closes its
   * stdin before the parent finishes writing. The write then raises `EPIPE` on a stream with no
   * `error` listener, which in Node is an UNCAUGHT exception in the SDK's own process — thrown by a
   * child that did nothing wrong.
   *
   * It surfaced here as a real failure rather than a theory: `foreign-hook-runtime-contract.test.ts`
   * came over in the #522 cherry-pick, and the coverage run reported "Vitest caught 1 unhandled
   * error" against it. The fix was one line inside the 5.x MAJOR commit, so the backport carried the
   * test that trips the defect and left the defect in place.
   *
   * The payload must exceed the pipe buffer (64 KiB on Linux). Below it the write lands in the
   * kernel buffer and returns before the child is gone, so a smaller string passes with or without
   * the listener and would assert nothing.
   */
  it("does not raise an uncaught EPIPE in this process", async () => {
    const uncaught: Error[] = [];
    const onUncaught = (err: Error): void => {
      uncaught.push(err);
    };
    process.on("uncaughtException", onUncaught);
    try {
      const result = await spawnAndCollect({
        command: NODE,
        args: ["-e", "process.exit(1)"],
        cwd: process.cwd(),
        stdin: "x".repeat(256 * 1024),
      });

      // The child's own outcome is still collected — a payload nobody read is not a failed spawn.
      expect(result.exitCode).toBe(1);
      expect(uncaught.map((e) => e.message)).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });
});

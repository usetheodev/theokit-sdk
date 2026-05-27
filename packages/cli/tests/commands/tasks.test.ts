/**
 * Phase 6 (T6.1) — `theokit tasks {list|inspect|cancel}` tests.
 * Covers fresh-install ENOENT (EC-6), invalid id grammar (EC-2/3),
 * not-found exit code, and cross-process cancel via cancelRequested
 * flag (EC-7).
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runTasksCancel, runTasksInspect, runTasksList } from "../../src/commands/tasks.js";

interface TaskHandleShape {
  id: string;
  kind: string;
  state: string;
  submittedAt: number;
  cancelRequested?: boolean;
}

function captureStdout(): { restore: () => void; output: () => string } {
  const orig = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];
  (process.stdout as { write: (chunk: string) => boolean }).write = (chunk: string) => {
    chunks.push(chunk);
    return true;
  };
  return { restore: () => (process.stdout.write = orig), output: () => chunks.join("") };
}
function captureStderr(): { restore: () => void; output: () => string } {
  const orig = process.stderr.write.bind(process.stderr);
  const chunks: string[] = [];
  (process.stderr as { write: (chunk: string) => boolean }).write = (chunk: string) => {
    chunks.push(chunk);
    return true;
  };
  return { restore: () => (process.stderr.write = orig), output: () => chunks.join("") };
}

describe("theokit tasks — fresh-install ENOENT (EC-6)", () => {
  let dir: string;
  let origEnv: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tasks-cli-"));
    origEnv = process.env.THEOKIT_HOME;
    process.env.THEOKIT_HOME = dir;
  });
  afterEach(async () => {
    if (origEnv === undefined) delete process.env.THEOKIT_HOME;
    else process.env.THEOKIT_HOME = origEnv;
    await rm(dir, { recursive: true, force: true });
  });

  it("list on fresh dir prints 'No tasks found.' and exits 0", async () => {
    const stdout = captureStdout();
    try {
      const code = await runTasksList({});
      expect(code).toBe(0);
      expect(stdout.output()).toMatch(/No tasks found\./);
    } finally {
      stdout.restore();
    }
  });

  it("list with --json on fresh dir emits []", async () => {
    const stdout = captureStdout();
    try {
      const code = await runTasksList({ json: true });
      expect(code).toBe(0);
      expect(JSON.parse(stdout.output())).toEqual([]);
    } finally {
      stdout.restore();
    }
  });
});

describe("theokit tasks — id validation + not-found", () => {
  let dir: string;
  let origEnv: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tasks-cli-"));
    origEnv = process.env.THEOKIT_HOME;
    process.env.THEOKIT_HOME = dir;
  });
  afterEach(async () => {
    if (origEnv === undefined) delete process.env.THEOKIT_HOME;
    else process.env.THEOKIT_HOME = origEnv;
    await rm(dir, { recursive: true, force: true });
  });

  it("inspect with invalid id exits 3", async () => {
    const stderr = captureStderr();
    try {
      expect(await runTasksInspect("BAD UPPER", {})).toBe(3);
      expect(stderr.output()).toMatch(/invalid id grammar/);
    } finally {
      stderr.restore();
    }
  });

  it("cancel with invalid id exits 3", async () => {
    const stderr = captureStderr();
    try {
      expect(await runTasksCancel("../etc/passwd", {})).toBe(3);
    } finally {
      stderr.restore();
    }
  });

  it("inspect unknown id exits 4", async () => {
    const stderr = captureStderr();
    try {
      expect(await runTasksInspect("definitely-missing", {})).toBe(4);
      expect(stderr.output()).toMatch(/not found/);
    } finally {
      stderr.restore();
    }
  });

  it("cancel unknown id exits 4", async () => {
    const stderr = captureStderr();
    try {
      expect(await runTasksCancel("never-existed", {})).toBe(4);
    } finally {
      stderr.restore();
    }
  });
});

describe("theokit tasks — cross-process cancel via flag (EC-7)", () => {
  let dir: string;
  let origEnv: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tasks-cli-"));
    origEnv = process.env.THEOKIT_HOME;
    process.env.THEOKIT_HOME = dir;
  });
  afterEach(async () => {
    if (origEnv === undefined) delete process.env.THEOKIT_HOME;
    else process.env.THEOKIT_HOME = origEnv;
    await rm(dir, { recursive: true, force: true });
  });

  function plantTask(handle: TaskHandleShape): void {
    const tasksDir = join(dir, "tasks");
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(join(tasksDir, `${handle.id}.json`), JSON.stringify(handle), "utf8");
  }

  it("cancel running task sets cancelRequested flag + prints message", async () => {
    plantTask({ id: "running-1", kind: "custom", state: "running", submittedAt: Date.now() });
    const stdout = captureStdout();
    try {
      expect(await runTasksCancel("running-1", {})).toBe(0);
      expect(stdout.output()).toMatch(/cancel requested/);
    } finally {
      stdout.restore();
    }
    const written = JSON.parse(readFileSync(join(dir, "tasks", "running-1.json"), "utf8"));
    expect(written.cancelRequested).toBe(true);
  });

  it("cancel queued task transitions directly to cancelled", async () => {
    plantTask({ id: "queued-1", kind: "custom", state: "queued", submittedAt: Date.now() });
    const stdout = captureStdout();
    try {
      expect(await runTasksCancel("queued-1", {})).toBe(0);
      expect(stdout.output()).toMatch(/was queued/);
    } finally {
      stdout.restore();
    }
    const written = JSON.parse(readFileSync(join(dir, "tasks", "queued-1.json"), "utf8"));
    expect(written.state).toBe("cancelled");
  });

  it("cancel terminal task prints already-terminal and exits 0", async () => {
    plantTask({ id: "done-1", kind: "custom", state: "finished", submittedAt: Date.now() });
    const stdout = captureStdout();
    try {
      expect(await runTasksCancel("done-1", {})).toBe(0);
      expect(stdout.output()).toMatch(/already terminal/);
    } finally {
      stdout.restore();
    }
  });
});

describe("theokit tasks — list/inspect happy path", () => {
  let dir: string;
  let origEnv: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tasks-cli-"));
    origEnv = process.env.THEOKIT_HOME;
    process.env.THEOKIT_HOME = dir;
    const tasksDir = join(dir, "tasks");
    mkdirSync(tasksDir, { recursive: true });
    const handle = {
      id: "demo-1",
      kind: "custom",
      state: "finished",
      submittedAt: 1000,
      finishedAt: 2000,
      result: "ok",
    };
    writeFileSync(join(tasksDir, "demo-1.json"), JSON.stringify(handle), "utf8");
  });
  afterEach(async () => {
    if (origEnv === undefined) delete process.env.THEOKIT_HOME;
    else process.env.THEOKIT_HOME = origEnv;
    await rm(dir, { recursive: true, force: true });
  });

  it("list prints table with the demo task", async () => {
    const stdout = captureStdout();
    try {
      expect(await runTasksList({})).toBe(0);
      const out = stdout.output();
      expect(out).toMatch(/demo-1/);
      expect(out).toMatch(/finished/);
    } finally {
      stdout.restore();
    }
  });

  it("inspect prints handle fields", async () => {
    const stdout = captureStdout();
    try {
      expect(await runTasksInspect("demo-1", {})).toBe(0);
      const out = stdout.output();
      expect(out).toMatch(/demo-1/);
      expect(out).toMatch(/finished/);
    } finally {
      stdout.restore();
    }
  });

  it("inspect --json emits valid JSON", async () => {
    const stdout = captureStdout();
    try {
      expect(await runTasksInspect("demo-1", { json: true })).toBe(0);
      const parsed = JSON.parse(stdout.output());
      expect(parsed.id).toBe("demo-1");
    } finally {
      stdout.restore();
    }
  });
});

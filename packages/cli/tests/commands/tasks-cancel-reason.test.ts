import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileTaskStore } from "@theokit/sdk/task-store";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runTasksCancel } from "../../src/commands/tasks.js";

/*
 * #351 — `theokit tasks cancel --reason <r>` was registered, described in `--help` as
 * "Cancellation reason recorded in the registry", and read by nothing. The user got exit 0 and no
 * warning, and reasonably concluded the flag worked.
 */

let home: string;
let prevHome: string | undefined;

const store = (): JsonFileTaskStore => new JsonFileTaskStore(join(home, "tasks"));

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cli-tasks-"));
  prevHome = process.env.THEOKIT_HOME;
  process.env.THEOKIT_HOME = home;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.THEOKIT_HOME;
  else process.env.THEOKIT_HOME = prevHome;
  vi.restoreAllMocks();
  await rm(home, { recursive: true, force: true });
});

it("records the reason on a queued task it cancels", async () => {
  await store().insert({ id: "t-1", kind: "custom", state: "queued", submittedAt: 1 });

  expect(await runTasksCancel("t-1", { reason: "superseded by t-2" })).toBe(0);

  const handle = await store().get("t-1");
  expect(handle?.state).toBe("cancelled");
  expect(handle?.cancelReason).toBe("superseded by t-2");
});

it("records the reason on a running task it flags", async () => {
  await store().insert({ id: "t-2", kind: "custom", state: "running", submittedAt: 1 });

  expect(await runTasksCancel("t-2", { reason: "user hit stop" })).toBe(0);

  const handle = await store().get("t-2");
  expect(handle?.cancelRequested).toBe(true);
  expect(handle?.cancelReason).toBe("user hit stop");
});

it("writes no reason when the flag is absent, and leaves a terminal task untouched", async () => {
  // The accepted cases (`testing.md` § 4.2). A cancel that always stamped something would satisfy
  // both tests above while inventing a reason nobody gave, and one that always wrote would
  // overwrite the record of a task that already ended.
  await store().insert({ id: "t-3", kind: "custom", state: "queued", submittedAt: 1 });
  await store().insert({ id: "t-4", kind: "custom", state: "finished", submittedAt: 1 });

  expect(await runTasksCancel("t-3", {})).toBe(0);
  expect(await runTasksCancel("t-4", { reason: "too late" })).toBe(0);

  expect((await store().get("t-3"))?.cancelReason).toBeUndefined();
  expect((await store().get("t-4"))?.state).toBe("finished");
  expect((await store().get("t-4"))?.cancelReason).toBeUndefined();
});

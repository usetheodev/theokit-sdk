/**
 * B-022 / B-099 — `tests/load/_harness/socket-monitor.ts` unit coverage.
 *
 * This file is placed OUTSIDE `tests/load/` deliberately: the actual load
 * test (`tests/load/1000-concurrent-sse.test.ts`) is owned by another
 * batch and off-limits for this slice, but the harness it imports is not,
 * and had no unit coverage of its own — every prior "test" of it was an
 * indirect side-effect of running the 1000-connection load scenario.
 *
 * ## The seam
 *
 * `probeSocketsResult` branches on `node:os`'s `platform()` and shells out
 * via `node:child_process`'s `execFileSync`. Both are mocked so the
 * "non-Linux" and "`ss` fails" paths — the exact two paths B-099 found
 * silently collapsing into a green test — are exercised deterministically
 * on THIS machine (Linux, with `ss`), not left to whichever CI runner
 * happens to lack one.
 *
 * ## Mutation counter-proof (executed manually against the production file)
 *
 * | Mutation in `socket-monitor.ts` | Test that dies |
 * |---|---|
 * | `if (os !== "linux")` → `if (false)` (always probes) | `probe_result_reports_unavailable_with_reason_on_non_linux_platform` — asserts `available: false` when `platform()` returns `"darwin"`; with the mutant the mock `execFileSync` is invoked and the fake `ss` output flows through instead |
 * | `if (!result.available) throw …` deleted in `assertNoLingeringCloseWait` | `throws a named error when the result is unavailable, instead of passing silently` — with the line deleted, the function falls through to `result.snapshot.closeWaitCount` on an object with no `snapshot`, so it throws an unrelated `TypeError` instead of the named diagnostic the test asserts on |
 * | `result.snapshot.closeWaitCount > threshold` → `>=` in `waitForCloseWaitBelow`'s loop guard | `treats a count exactly AT threshold as satisfied — no extra poll` — a count exactly at threshold polls once more under the mutant and returns the second (lower) reading instead of the first |
 */
import { execFileSync } from "node:child_process";
import { platform } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertNoLingeringCloseWait,
  probeSockets,
  probeSocketsResult,
  waitForCloseWaitBelow,
} from "./load/_harness/socket-monitor.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("node:os", () => ({ platform: vi.fn() }));

const mockExecFileSync = vi.mocked(execFileSync);
const mockPlatform = vi.mocked(platform);

function ssOutput(pid: number, closeWait: number, timeWait: number, estab: number): string {
  const lines: string[] = [];
  for (let i = 0; i < closeWait; i++)
    lines.push(`CLOSE-WAIT 0 0 1.2.3.4:1 5.6.7.8:2 users:(("node",pid=${pid},fd=3))`);
  for (let i = 0; i < timeWait; i++)
    lines.push(`TIME-WAIT 0 0 1.2.3.4:1 5.6.7.8:2 users:(("node",pid=${pid},fd=3))`);
  for (let i = 0; i < estab; i++)
    lines.push(`ESTAB 0 0 1.2.3.4:1 5.6.7.8:2 users:(("node",pid=${pid},fd=3))`);
  return lines.join("\n");
}

beforeEach(() => {
  mockPlatform.mockReturnValue("linux");
  mockExecFileSync.mockReturnValue(ssOutput(4321, 0, 0, 0));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("probeSocketsResult", () => {
  it("parses CLOSE_WAIT / TIME_WAIT / ESTAB counts for the matching pid on Linux", () => {
    mockExecFileSync.mockReturnValue(ssOutput(4321, 3, 2, 1));

    const result = probeSocketsResult(4321);

    expect(result).toEqual({
      available: true,
      snapshot: { pid: 4321, closeWaitCount: 3, timeWaitCount: 2, establishedCount: 1 },
    });
  });

  it("reports unavailable with a reason naming the platform on non-Linux", () => {
    mockPlatform.mockReturnValue("darwin");

    const result = probeSocketsResult(4321);

    expect(result.available).toBe(false);
    if (result.available) throw new Error("unreachable");
    expect(result.reason).toContain("darwin");
    expect(result.reason).toContain("Linux-only");
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("reports unavailable with a reason naming the failure when ss itself throws", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("ss: command not found");
    });

    const result = probeSocketsResult(4321);

    expect(result.available).toBe(false);
    if (result.available) throw new Error("unreachable");
    expect(result.reason).toContain("ss -tnp");
    expect(result.reason).toContain("command not found");
  });
});

describe("probeSockets (deprecated wrapper)", () => {
  it("returns the snapshot when available", () => {
    mockExecFileSync.mockReturnValue(ssOutput(4321, 1, 0, 0));
    expect(probeSockets(4321)).toEqual({
      pid: 4321,
      closeWaitCount: 1,
      timeWaitCount: 0,
      establishedCount: 0,
    });
  });

  it("collapses unavailable to null for callers not yet migrated", () => {
    mockPlatform.mockReturnValue("win32");
    expect(probeSockets(4321)).toBeNull();
  });
});

describe("assertNoLingeringCloseWait", () => {
  it("passes silently when the count is at or under threshold", () => {
    expect(() =>
      assertNoLingeringCloseWait(
        {
          available: true,
          snapshot: { pid: 1, closeWaitCount: 5, timeWaitCount: 0, establishedCount: 0 },
        },
        5,
      ),
    ).not.toThrow();
  });

  it("throws with the measured count when the threshold is breached", () => {
    expect(() =>
      assertNoLingeringCloseWait(
        {
          available: true,
          snapshot: { pid: 1, closeWaitCount: 26, timeWaitCount: 0, establishedCount: 0 },
        },
        25,
      ),
    ).toThrowError(/26 CLOSE_WAIT sockets remain for pid 1 \(threshold 25\)/);
  });

  it("throws a named error when the result is unavailable, instead of passing silently", () => {
    // B-099's defect, inverted into a positive assertion: the pre-fix
    // `assertNoLingeringCloseWait` returned `undefined` here — a pass.
    expect(() =>
      assertNoLingeringCloseWait({
        available: false,
        reason: 'socket-monitor: platform "darwin" has no `ss`',
      }),
    ).toThrowError(/cannot assert — socket-monitor: platform "darwin"/);
  });
});

describe("waitForCloseWaitBelow", () => {
  it("returns immediately, without polling, when already under threshold", async () => {
    mockExecFileSync.mockReturnValue(ssOutput(999, 2, 0, 0));

    const result = await waitForCloseWaitBelow(5, {
      pid: 999,
      deadlineMs: 2_000,
      pollIntervalMs: 10,
    });

    expect(result).toEqual({
      available: true,
      snapshot: { pid: 999, closeWaitCount: 2, timeWaitCount: 0, establishedCount: 0 },
    });
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("treats a count exactly AT threshold as satisfied — no extra poll", async () => {
    // Boundary case for the loop guard: `closeWaitCount > threshold`, not `>=`.
    // A `>=` mutant would poll once more here and observe the second (lower)
    // reading instead of returning on the first.
    let call = 0;
    mockExecFileSync.mockImplementation(() => {
      call += 1;
      return ssOutput(999, call === 1 ? 5 : 3, 0, 0);
    });

    const result = await waitForCloseWaitBelow(5, { pid: 999, deadlineMs: 200, pollIntervalMs: 5 });

    expect(result).toEqual({
      available: true,
      snapshot: { pid: 999, closeWaitCount: 5, timeWaitCount: 0, establishedCount: 0 },
    });
    expect(call).toBe(1);
  });

  it("returns immediately when unavailable — nothing to poll for", async () => {
    mockPlatform.mockReturnValue("darwin");

    const result = await waitForCloseWaitBelow(5, {
      pid: 999,
      deadlineMs: 2_000,
      pollIntervalMs: 10,
    });

    expect(result.available).toBe(false);
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("polls until the count drops below threshold, then returns the passing snapshot", async () => {
    let call = 0;
    mockExecFileSync.mockImplementation(() => {
      call += 1;
      // First two polls see 10 lingering sockets; from the third the OS has drained them.
      return ssOutput(999, call < 3 ? 10 : 1, 0, 0);
    });

    const result = await waitForCloseWaitBelow(5, {
      pid: 999,
      deadlineMs: 2_000,
      pollIntervalMs: 5,
    });

    expect(result).toEqual({
      available: true,
      snapshot: { pid: 999, closeWaitCount: 1, timeWaitCount: 0, establishedCount: 0 },
    });
    expect(call).toBeGreaterThanOrEqual(3);
  });

  it("gives up at the deadline and returns the final over-threshold snapshot, not a throw", async () => {
    mockExecFileSync.mockReturnValue(ssOutput(999, 999, 0, 0));

    const start = Date.now();
    const result = await waitForCloseWaitBelow(5, { pid: 999, deadlineMs: 80, pollIntervalMs: 10 });
    const elapsed = Date.now() - start;

    expect(result).toEqual({
      available: true,
      snapshot: { pid: 999, closeWaitCount: 999, timeWaitCount: 0, establishedCount: 0 },
    });
    expect(elapsed).toBeGreaterThanOrEqual(70);
    expect(elapsed).toBeLessThan(2_000);
  });
});

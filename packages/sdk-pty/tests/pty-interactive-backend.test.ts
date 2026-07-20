import { InteractiveUnavailableError, NoSuchSessionError } from "@theokit/sdk/interactive";
import { afterEach, describe, expect, it } from "vitest";

import {
  clampYield,
  PtyInteractiveBackend,
  YIELD_MAX_MS,
  YIELD_MIN_MS,
} from "../src/pty-interactive-backend.js";

// These tests spawn REAL PTYs (integration-grade). Skipped automatically when node-pty's native build
// is unavailable (CI without a toolchain).
const probe = new PtyInteractiveBackend();
const hasPty = probe.available();
const d = hasPty ? describe : describe.skip;

let backend: PtyInteractiveBackend;
afterEach(() => {
  backend?.killAll();
});

d("PtyInteractiveBackend (real PTY)", () => {
  it("starts a session and returns a session id", async () => {
    backend = new PtyInteractiveBackend();
    const { sessionId, output } = await backend.startInteractive("cat", { yieldMs: 300 });
    expect(sessionId).toMatch(/.+/);
    expect(typeof output).toBe("string");
  });

  it("writes stdin and reads the echoed output back", async () => {
    backend = new PtyInteractiveBackend();
    const { sessionId } = await backend.startInteractive("cat", { yieldMs: 300 });
    const { output, alive } = await backend.writeStdin(sessionId, "ping-123\n", { yieldMs: 400 });
    expect(output).toContain("ping-123");
    expect(alive).toBe(true);
  });

  it("rejects a write to a killed session with a TYPED NoSuchSessionError", async () => {
    backend = new PtyInteractiveBackend();
    const { sessionId } = await backend.startInteractive("cat", { yieldMs: 300 });
    backend.kill(sessionId);
    await expect(backend.writeStdin(sessionId, "x\n", { yieldMs: 300 })).rejects.toBeInstanceOf(
      NoSuchSessionError,
    );
  });

  it("kill reaps a DETACHED grandchild (process-group kill, not just the shell)", async () => {
    backend = new PtyInteractiveBackend();
    const { sessionId, output } = await backend.startInteractive("sleep 300 & echo PID=$!; wait", {
      yieldMs: 600,
    });
    const gpid = Number(/PID=(\d+)/.exec(output)?.[1] ?? 0);
    expect(gpid).toBeGreaterThan(0);
    expect(() => process.kill(gpid, 0)).not.toThrow(); // alive before kill
    backend.kill(sessionId);
    await new Promise((r) => setTimeout(r, 300));
    expect(() => process.kill(gpid, 0)).toThrow(); // ESRCH — reaped
  });

  it("an idle session is reaped by its TTL", async () => {
    backend = new PtyInteractiveBackend();
    await backend.startInteractive("cat", { yieldMs: 200, ttlMs: 400 });
    expect(backend.activeSessionCount()).toBe(1);
    await new Promise((r) => setTimeout(r, 650));
    expect(backend.activeSessionCount()).toBe(0);
  });

  it("a spawn-time failure (bad cwd) degrades to a TYPED InteractiveUnavailableError", async () => {
    backend = new PtyInteractiveBackend();
    await expect(
      backend.startInteractive("cat", { cwd: "/no/such/dir/xyzzy", yieldMs: 200 }),
    ).rejects.toBeInstanceOf(InteractiveUnavailableError);
  });

  it("serializes concurrent writes — each reads its OWN output window", async () => {
    backend = new PtyInteractiveBackend();
    const { sessionId } = await backend.startInteractive("cat", { yieldMs: 300 });
    const a = backend.writeStdin(sessionId, "AAA\n", { yieldMs: 300 });
    const b = backend.writeStdin(sessionId, "BBB\n", { yieldMs: 300 });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.output).toContain("AAA");
    expect(ra.output).not.toContain("BBB");
    expect(rb.output).toContain("BBB");
  });
});

describe("clampYield (pure)", () => {
  it("clamps an absurd yield down to the max", () => {
    expect(clampYield(999_999)).toBe(YIELD_MAX_MS);
  });
  it("clamps a tiny yield up to the min", () => {
    expect(clampYield(1)).toBe(YIELD_MIN_MS);
  });
  it("passes an in-range yield through", () => {
    expect(clampYield(1000)).toBe(1000);
  });
});

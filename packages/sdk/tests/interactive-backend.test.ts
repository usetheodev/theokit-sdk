import { describe, expect, it } from "vitest";
import {
  InteractiveBackend,
  type InteractiveProvider,
  InteractiveUnavailableError,
  NoSuchSessionError,
  resolveInteractive,
  type StartInteractiveResult,
  type WriteStdinResult,
} from "../src/interactive/index.js";
import { expectPublicError } from "./helpers/assert-public-error.js";

/** Minimal in-memory backend: each session echoes whatever is written to it. Proves the CONTRACT
 *  (start → id, write → echo + alive, kill → NoSuchSession) without a real PTY. */
class FakeInteractiveBackend extends InteractiveBackend {
  private live = new Set<string>();
  private n = 0;

  async startInteractive(command: string): Promise<StartInteractiveResult> {
    this.n += 1;
    const sessionId = `fake-${this.n}`;
    this.live.add(sessionId);
    return { sessionId, output: `started: ${command}` };
  }

  async writeStdin(sessionId: string, chars: string): Promise<WriteStdinResult> {
    if (!this.live.has(sessionId)) throw new NoSuchSessionError(sessionId);
    return { output: chars, alive: true };
  }

  kill(sessionId: string): void {
    this.live.delete(sessionId);
  }
}

describe("InteractiveBackend contract (fake echo backend)", () => {
  it("starts a session and returns an id + startup output", async () => {
    const backend = new FakeInteractiveBackend();
    const { sessionId, output } = await backend.startInteractive("cat");
    expect(sessionId).toMatch(/.+/);
    expect(output).toContain("cat");
  });

  it("writes to a live session and reads the echoed output back (alive)", async () => {
    const backend = new FakeInteractiveBackend();
    const { sessionId } = await backend.startInteractive("cat");
    const { output, alive } = await backend.writeStdin(sessionId, "ping\n");
    expect(output).toBe("ping\n");
    expect(alive).toBe(true);
  });

  it("rejects a write to a killed session with a TYPED NoSuchSessionError", async () => {
    const backend = new FakeInteractiveBackend();
    const { sessionId } = await backend.startInteractive("cat");
    backend.kill(sessionId);
    await expect(backend.writeStdin(sessionId, "x\n")).rejects.toBeInstanceOf(NoSuchSessionError);
  });
});

describe("resolveInteractive (mirrors resolveFilesystem)", () => {
  it("returns a backend instance passed directly", async () => {
    const backend = new FakeInteractiveBackend();
    expect(await resolveInteractive(backend, {})).toBe(backend);
  });

  it("invokes a per-request resolver function with the ctx", async () => {
    const backend = new FakeInteractiveBackend();
    let seenCtx: unknown;
    const provider: InteractiveProvider<{ role: string }> = (ctx) => {
      seenCtx = ctx;
      return backend;
    };
    const resolved = await resolveInteractive(provider, { role: "admin" });
    expect(resolved).toBe(backend);
    expect(seenCtx).toEqual({ role: "admin" });
  });

  it("awaits an async resolver", async () => {
    const backend = new FakeInteractiveBackend();
    const provider: InteractiveProvider = () => Promise.resolve(backend);
    expect(await resolveInteractive(provider, undefined)).toBe(backend);
  });
});

describe("typed errors", () => {
  it("InteractiveUnavailableError carries a stable code + name", () => {
    const err = new InteractiveUnavailableError("no pty");
    expectPublicError(err, { ctor: Error, code: "interactive_unavailable" });
  });

  it("NoSuchSessionError names the session + stable code", () => {
    const err = new NoSuchSessionError("s-1");
    expect(err.name).toBe("NoSuchSessionError");
    expect(err.code).toBe("no_such_session");
    expect(err.message).toContain("s-1");
  });
});

import {
  InteractiveBackend,
  InteractiveUnavailableError,
  NoSuchSessionError,
  type StartInteractiveResult,
  type WriteStdinResult,
} from "@theokit/sdk/interactive";
import { describe, expect, it } from "vitest";

import { createInteractiveShellTool, createWriteStdinTool } from "../src/interactive-shell.js";
import { textHandler } from "./text-handler.js";

/** In-memory echo backend — proves the tools drive the INJECTED InteractiveBackend. */
class FakeBackend extends InteractiveBackend {
  private live = new Set<string>();
  private n = 0;
  async startInteractive(command: string): Promise<StartInteractiveResult> {
    this.n += 1;
    const sessionId = `s-${this.n}`;
    this.live.add(sessionId);
    return { sessionId, output: `> ${command}` };
  }
  async writeStdin(sessionId: string, chars: string): Promise<WriteStdinResult> {
    if (!this.live.has(sessionId)) throw new NoSuchSessionError(sessionId);
    return { output: chars.trim(), alive: true };
  }
  kill(sessionId: string): void {
    this.live.delete(sessionId);
  }
}

/** A backend that cannot allocate a session (e.g. node-pty missing). */
class UnavailableBackend extends InteractiveBackend {
  async startInteractive(): Promise<StartInteractiveResult> {
    throw new InteractiveUnavailableError("no pty");
  }
  async writeStdin(): Promise<WriteStdinResult> {
    throw new InteractiveUnavailableError("no pty");
  }
  kill(): void {}
}

describe("interactive_shell + write_stdin (injected InteractiveBackend)", () => {
  it("starts a session via the injected backend and returns { ok, session_id, output }", async () => {
    const tool = createInteractiveShellTool({ interactive: new FakeBackend() });
    const parsed = JSON.parse(await textHandler(tool)({ command: "python3" }));
    expect(parsed.ok).toBe(true);
    expect(parsed.session_id).toMatch(/.+/);
    expect(parsed.output).toContain("python3");
  });

  it("drives a session end-to-end: start then write_stdin echoes the input", async () => {
    const backend = new FakeBackend();
    const start = createInteractiveShellTool({ interactive: backend });
    const write = createWriteStdinTool({ interactive: backend });
    const { session_id } = JSON.parse(await textHandler(start)({ command: "cat" }));
    const parsed = JSON.parse(await textHandler(write)({ session_id, input: "6*7\n" }));
    expect(parsed.ok).toBe(true);
    expect(parsed.output).toBe("6*7");
    expect(parsed.alive).toBe(true);
  });

  it("returns { ok:false, error:'interactive_unavailable' } when the backend cannot allocate", async () => {
    const tool = createInteractiveShellTool({ interactive: new UnavailableBackend() });
    const parsed = JSON.parse(await textHandler(tool)({ command: "python3" }));
    expect(parsed).toEqual({ ok: false, error: "interactive_unavailable" });
  });

  it("returns { ok:false, error:'no_such_session' } for a write to an unknown session", async () => {
    const tool = createWriteStdinTool({ interactive: new FakeBackend() });
    const parsed = JSON.parse(await textHandler(tool)({ session_id: "nope", input: "x\n" }));
    expect(parsed).toEqual({ ok: false, error: "no_such_session" });
  });
});

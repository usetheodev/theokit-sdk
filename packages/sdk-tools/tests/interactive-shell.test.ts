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

/**
 * U-2 — a subclass carrying actionable fields must not be flattened by its superclass.
 *
 * `toErrorJson` matched `InteractiveUnavailableError` first, so `MaxSessionsError` — which extends
 * it — took that branch and lost `max` and `liveSessionIds`. Those are the only actionable fields
 * in the error: without them the model reads "interactive_unavailable" and cannot tell a missing
 * backend from a session cap it could clear by reusing an open session. `@theokit/sdk-pty`'s own
 * docblock says those fields exist so the caller can act.
 *
 * The check is STRUCTURAL, not `instanceof`: `MaxSessionsError` lives in `@theokit/sdk-pty`, which
 * this package does not and should not depend on. A backend from any provider that reports the same
 * two fields gets the same treatment, which is the correct contract for a tool that accepts an
 * injected backend.
 *
 * Measured from a consumer (TheoCode) that forked this tool's whole schema and handler to recover
 * them, because there is no error seam to override.
 */
class CappedBackend extends InteractiveBackend {
  async startInteractive(): Promise<StartInteractiveResult> {
    throw Object.assign(new InteractiveUnavailableError("interactive session limit reached"), {
      max: 2,
      liveSessionIds: ["s-1", "s-2"],
    });
  }
  async writeStdin(): Promise<WriteStdinResult> {
    throw new InteractiveUnavailableError("no pty");
  }
  kill(): void {}
}

describe("U-2 — the session cap keeps the fields that make it actionable", () => {
  it("test_a_session_cap_reports_its_limit_and_live_sessions", async () => {
    const tool = createInteractiveShellTool({ interactive: () => new CappedBackend() });

    const out = JSON.parse(await textHandler(tool)({ command: "bash -i" })) as Record<
      string,
      unknown
    >;

    expect(out.error).toBe("interactive_session_limit");
    expect(out.max).toBe(2);
    expect(out.live_session_ids).toEqual(["s-1", "s-2"]);
  });

  it("test_a_plain_unavailable_error_is_unchanged", async () => {
    // Anti-vacuity floor: emitting the cap shape for everything would satisfy the test above.
    const tool = createInteractiveShellTool({ interactive: () => new UnavailableBackend() });

    const out = JSON.parse(await textHandler(tool)({ command: "bash -i" })) as Record<
      string,
      unknown
    >;

    expect(out.error).toBe("interactive_unavailable");
    expect(out.max).toBeUndefined();
  });
});

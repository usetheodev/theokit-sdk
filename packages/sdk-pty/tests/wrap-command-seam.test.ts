/**
 * M75 T3.1 — the PTY accepts an injected wrap function instead of requiring inheritance.
 *
 * ## What was there and why it changed
 *
 * agent-builder had `SandboxedInteractiveBackend extends PtyInteractiveBackend`, 99 lines whose
 * `override startInteractive` rewrote the **whole** method — just to transform a string. Because it
 * lived there, the override accumulated what is not its own: bwrap detection, the WARN-once and the `cwd`
 * default. Every PTY evolution (a new field in `StartInteractiveOptions`, a change in
 * signature) forced the subclass to follow along.
 *
 * A function is the minimal contract (ISP): the PTY keeps owning the spawn, the sandbox keeps owning the
 * policy, and neither needs to know the other's type. That is what allows
 * `createInteractiveShellTool({ interactive, sandbox })` compose for real.
 *
 * ## Why `string | null` and not `string`
 *
 * `null` means **do not wrap** — the `danger-full-access` case, an explicit opt-out. Returning the
 * raw command would conflate "I decided not to confine" with "I confined and the result is identical"; and a
 * caller wanting to audit the decision would have no way to tell them apart.
 */
import { describe, expect, it } from "vitest";

import { PtyInteractiveBackend } from "../src/pty-interactive-backend.js";

/**
 * Captures the command that REACHES `pty.spawn`, without touching a real PTY.
 *
 * The first version of this helper replaced the whole of `spawnPty` — and so the wrap, which lives INSIDE
 * it, never ran: the test measured its own fixture and failed by construction. Intercepting the
 * `node-pty` module measures the real path (`startInteractive` -> `spawnPty` -> wrap -> `pty.spawn`), which is the
 * only thing that proves the link.
 */
const captureSpawnedCommand = (backend: PtyInteractiveBackend): string[] => {
  const seen: string[] = [];
  const target = backend as unknown as { ptyModule: unknown };
  target.ptyModule = {
    spawn: (_shell: string, args: string[]) => {
      seen.push(args[1] ?? "");
      throw new Error("spawn intercepted — the command was already captured");
    },
  };
  return seen;
};

describe("M75 T3.1 — wrapCommand injected into PtyInteractiveBackend", () => {
  it("test_the_wrap_is_applied_before_the_spawn", async () => {
    const b = new PtyInteractiveBackend({ wrapCommand: (cmd) => `WRAPPED:${cmd}` });
    const seen = captureSpawnedCommand(b);
    await b.startInteractive("echo hi").catch(() => undefined);
    expect(seen[0], "the command reached the spawn without going through the wrap").toBe(
      "WRAPPED:echo hi",
    );
  });

  it("test_the_wrap_receives_the_resolved_cwd_not_the_raw_one", async () => {
    // The PTY spawns in THIS cwd; the wrap must target the SAME directory, otherwise bwrap's binds
    // would point one way and the process would run another — confinement that confines nothing.
    const cwds: string[] = [];
    const b = new PtyInteractiveBackend({
      wrapCommand: (cmd, cwd) => {
        cwds.push(cwd);
        return cmd;
      },
    });
    captureSpawnedCommand(b);
    await b.startInteractive("true", { cwd: "/tmp" }).catch(() => undefined);
    expect(cwds[0]).toBe("/tmp");
  });

  it("test_null_means_do_not_wrap", async () => {
    const b = new PtyInteractiveBackend({ wrapCommand: () => null });
    const seen = captureSpawnedCommand(b);
    await b.startInteractive("echo hi").catch(() => undefined);
    expect(seen[0], "null must leave the command exactly as it came").toBe("echo hi");
  });

  it("test_without_the_option_the_behavior_is_the_current_one", async () => {
    // Backward compatibility: the change is ADDITIVE. Every consumer already building the backend without
    // options is unchanged — that is what allows publishing as a minor.
    const b = new PtyInteractiveBackend();
    const seen = captureSpawnedCommand(b);
    await b.startInteractive("echo hi").catch(() => undefined);
    expect(seen[0]).toBe("echo hi");
  });
});

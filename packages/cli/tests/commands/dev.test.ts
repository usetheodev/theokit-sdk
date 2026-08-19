/**
 * T4.1 — `runDev` is the orchestration layer of `theokit dev`: it resolves the
 * entry, announces it, spawns the watcher and translates every failure into an
 * exit code the shell can act on.
 *
 * Measured before this file existed (lcov, `packages/cli`, tests/dev +
 * tests/eval + tests/commands): `src/commands/dev.ts` 6/13 lines, 3/10
 * branches, `runDev` at `FNDA:1`. So it was NOT at zero — `tests/commands/
 * dispatch.test.ts` drives the missing-entry path end to end. What no test
 * reached was the whole SUCCESS path (the announcement, the spawn, the exit
 * code it returns) and the spawn-failure path.
 *
 * The two collaborators are mocked because they are the process boundary:
 * `startRunner` spawns `tsx --watch`, and `runDev` deliberately passes neither
 * `watch:false` nor `stdio:"ignore"`, so exercising it for real would leave a
 * live file watcher behind every run. `resolveEntry` has its own suite in
 * `tests/dev/entry-resolver.test.ts`, and `dispatch.test.ts` covers the two
 * wired together; this file is about what `runDev` itself decides.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveEntry: vi.fn<(cwd: string, explicit?: string) => string>(),
  startRunner:
    vi.fn<
      (opts: { entry: string; cwd: string; envFile?: string }) => {
        exited: Promise<number>;
      }
    >(),
}));

vi.mock("../../src/dev/entry-resolver.js", () => ({ resolveEntry: mocks.resolveEntry }));
vi.mock("../../src/dev/runner.js", () => ({ startRunner: mocks.startRunner }));

const { runDev } = await import("../../src/commands/dev.js");

/** picocolors emits SGR sequences when the stream looks like a TTY. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
function plain(chunks: string[]): string {
  return chunks.join("").replace(ANSI, "");
}

/** An error carrying the `code` discriminator `resolveEntry` attaches. */
function coded(message: string, code: string): Error {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  });
  mocks.resolveEntry.mockReset();
  mocks.startRunner.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runDev — the watch path", () => {
  it("announces the resolved entry before handing over to the runner", async () => {
    mocks.resolveEntry.mockReturnValue("/proj/src/index.ts");
    mocks.startRunner.mockReturnValue({ exited: Promise.resolve(0) });

    await runDev({});

    expect(plain(out)).toContain("[dev] watching /proj/src/index.ts");
    expect(plain(err)).toBe("");
  });

  it("returns the exit code the watched child reported", async () => {
    mocks.resolveEntry.mockReturnValue("/proj/src/index.ts");
    mocks.startRunner.mockReturnValue({ exited: Promise.resolve(7) });

    await expect(runDev({})).resolves.toBe(7);
  });

  it("returns 0 when the watched child exits cleanly", async () => {
    mocks.resolveEntry.mockReturnValue("/proj/src/index.ts");
    mocks.startRunner.mockReturnValue({ exited: Promise.resolve(0) });

    await expect(runDev({})).resolves.toBe(0);
  });

  it("spawns the runner against the resolved entry in the current directory", async () => {
    mocks.resolveEntry.mockReturnValue("/proj/src/index.ts");
    mocks.startRunner.mockReturnValue({ exited: Promise.resolve(0) });

    await runDev({});

    expect(mocks.startRunner).toHaveBeenCalledWith({
      entry: "/proj/src/index.ts",
      cwd: process.cwd(),
    });
  });

  it("forwards the --entry flag to the resolver rather than resolving it itself", async () => {
    mocks.resolveEntry.mockReturnValue("/proj/bot.ts");
    mocks.startRunner.mockReturnValue({ exited: Promise.resolve(0) });

    await runDev({ entry: "bot.ts" });

    expect(mocks.resolveEntry).toHaveBeenCalledWith(process.cwd(), "bot.ts");
  });
});

describe("runDev — the --env flag", () => {
  it("passes the given env file through to the runner", async () => {
    mocks.resolveEntry.mockReturnValue("/proj/src/index.ts");
    mocks.startRunner.mockReturnValue({ exited: Promise.resolve(0) });

    await runDev({ env: ".env.staging" });

    expect(mocks.startRunner.mock.calls[0]?.[0]).toMatchObject({ envFile: ".env.staging" });
  });

  it("omits envFile entirely when no --env was given, leaving the runner's default in force", async () => {
    // Passing `envFile: undefined` is NOT the same as omitting the key: the
    // runner reads `opts.envFile ?? ".env"`, so a present-but-undefined key is
    // equivalent today and would stop being so the moment that default moves.
    // The spread in dev.ts exists precisely to keep the key absent.
    mocks.resolveEntry.mockReturnValue("/proj/src/index.ts");
    mocks.startRunner.mockReturnValue({ exited: Promise.resolve(0) });

    await runDev({});

    const arg = mocks.startRunner.mock.calls[0]?.[0] ?? {};
    expect(Object.hasOwn(arg, "envFile")).toBe(false);
  });
});

describe("runDev — entry resolution failures", () => {
  it("exits 2 when the entry file cannot be found", async () => {
    mocks.resolveEntry.mockImplementation(() => {
      throw coded("Entry file not found: bot.ts", "entry_not_found");
    });

    await expect(runDev({ entry: "bot.ts" })).resolves.toBe(2);
  });

  it("prints the resolver's own message and code on stderr", async () => {
    mocks.resolveEntry.mockImplementation(() => {
      throw coded("Entry file not found: bot.ts", "entry_not_found");
    });

    await runDev({ entry: "bot.ts" });

    expect(plain(err)).toContain("error: Entry file not found: bot.ts");
    expect(plain(err)).toContain("(code: entry_not_found)");
  });

  it("exits 1 — not 2 — when resolution fails for some other reason", async () => {
    mocks.resolveEntry.mockImplementation(() => {
      throw coded("EACCES: permission denied", "eacces");
    });

    await expect(runDev({})).resolves.toBe(1);
  });

  it("reports the code as 'unknown' when the thrown error carries none", async () => {
    mocks.resolveEntry.mockImplementation(() => {
      throw new Error("something broke");
    });

    const code = await runDev({});

    expect(code).toBe(1);
    expect(plain(err)).toContain("(code: unknown)");
  });

  it("stringifies a non-Error thrown by the resolver instead of printing [object Object]", async () => {
    const notAnError: unknown = "resolver exploded";
    mocks.resolveEntry.mockImplementation(() => {
      throw notAnError;
    });

    const code = await runDev({});

    expect(code).toBe(1);
    expect(plain(err)).toContain("error: resolver exploded");
  });

  it("never announces a watch target when resolution failed", async () => {
    mocks.resolveEntry.mockImplementation(() => {
      throw coded("Entry file not found: bot.ts", "entry_not_found");
    });

    await runDev({ entry: "bot.ts" });

    expect(plain(out)).toBe("");
    expect(mocks.startRunner).not.toHaveBeenCalled();
  });
});

describe("runDev — spawn failures", () => {
  it("exits 1 when the runner cannot spawn tsx", async () => {
    mocks.resolveEntry.mockReturnValue("/proj/src/index.ts");
    mocks.startRunner.mockImplementation(() => {
      throw new Error("spawn ENOENT");
    });

    await expect(runDev({})).resolves.toBe(1);
  });

  it("surfaces the spawn error and the repair hint on stderr", async () => {
    mocks.resolveEntry.mockReturnValue("/proj/src/index.ts");
    mocks.startRunner.mockImplementation(() => {
      throw new Error("spawn ENOENT");
    });

    await runDev({});

    expect(plain(err)).toContain("error: could not spawn tsx — spawn ENOENT");
    expect(plain(err)).toContain("Hint: try `pnpm install` to repair @theokit/cli.");
  });

  it("stringifies a non-Error thrown by the runner", async () => {
    mocks.resolveEntry.mockReturnValue("/proj/src/index.ts");
    const notAnError: unknown = "tsx missing";
    mocks.startRunner.mockImplementation(() => {
      throw notAnError;
    });

    const code = await runDev({});

    expect(code).toBe(1);
    expect(plain(err)).toContain("could not spawn tsx — tsx missing");
  });
});

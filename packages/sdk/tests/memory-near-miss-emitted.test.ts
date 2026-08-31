import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDiagnosticsSink } from "../src/internal/diagnostics.js";
import { persistMemoryFactIfWritePrompt } from "../src/internal/local-agent/local-agent-runtime-extensions.js";
import { projectMemoryDir } from "../src/internal/memory/storage/memory-root.js";

/*
 * #462, the emitting half — the pure `unstoredRememberWarning` is covered next door.
 *
 * The reported defect is not that the gate rejects: a heuristic over user text SHOULD reject, or an
 * ordinary sentence about remembering becomes a durable fact. It is that rejection was
 * indistinguishable from success. This asserts the boundary behaviour a caller can observe: a
 * near-miss stores nothing AND reports, a supported phrase stores AND stays quiet.
 *
 * Both halves are asserted in each case. Reporting without checking the disk would pass for an
 * implementation that warns and then stores anyway; checking the disk without the diagnostic is the
 * state this issue describes.
 */
describe("a Remember phrase that stores nothing", () => {
  let cwd: string;
  let emitted: string[];

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "near-miss-"));
    emitted = [];
    setDiagnosticsSink((m) => emitted.push(m));
  });
  afterEach(() => setDiagnosticsSink(undefined));

  const storedFiles = (): string[] => {
    try {
      return readdirSync(projectMemoryDir(cwd));
    } catch {
      return [];
    }
  };

  it("test_a_near_miss_reports_and_writes_nothing", async () => {
    await persistMemoryFactIfWritePrompt(
      cwd,
      { enabled: true },
      "Remember, please: deploys go through the release branch",
    );
    expect(storedFiles()).toEqual([]);
    expect(emitted.join("")).toContain("NOTHING WAS STORED");
  });

  // The accepted input. Without it, an implementation that warned on every turn would pass above.
  it("test_a_supported_phrase_writes_and_stays_quiet", async () => {
    await persistMemoryFactIfWritePrompt(
      cwd,
      { enabled: true },
      "Remember (project): deploys go through the release branch",
    );
    expect(storedFiles().some((f) => f.endsWith(".md"))).toBe(true);
    expect(emitted.join("")).not.toContain("NOTHING WAS STORED");
  });

  // Memory off is not a near-miss: the caller did not ask for storage, so there is nothing to
  // report. A warning here would fire in every project that never enabled memory.
  it("test_memory_disabled_says_nothing", async () => {
    await persistMemoryFactIfWritePrompt(cwd, { enabled: false }, "Remember, please: something");
    expect(emitted.join("")).toBe("");
  });

  /*
   * The third silent path the issue names: the write itself failing.
   *
   * It went through `safeCall`, which reports on `diag` — dropped entirely with no sink installed.
   * So a permission error on the memory directory looked exactly like a successful capture. Same
   * `#189` distinction as the near-miss: the user asked for something durable, did not get it, and
   * the only report went to a channel a host may never read.
   */
  it("test_a_write_failure_reports_with_no_sink_installed", async () => {
    // The sink is CLEARED on purpose. With one installed, `diag` and `diagFailure` are
    // indistinguishable — both arrive — so a test that keeps it would pass against the very
    // behaviour being fixed. Production has no sink unless the host installs one, and that is the
    // condition under which the failure disappeared.
    setDiagnosticsSink(undefined);
    const written: string[] = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      // A file where the memory directory must be: every write under it fails with ENOTDIR.
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const { dirname } = await import("node:path");
      mkdirSync(dirname(projectMemoryDir(cwd)), { recursive: true });
      writeFileSync(projectMemoryDir(cwd), "not a directory");

      await persistMemoryFactIfWritePrompt(
        cwd,
        { enabled: true },
        "Remember (project): deploys go through the release branch",
      );
    } finally {
      process.stderr.write = realWrite;
    }
    expect(written.join("")).toContain("memory write failed");
  });

  it("test_an_ordinary_turn_says_nothing", async () => {
    await persistMemoryFactIfWritePrompt(cwd, { enabled: true }, "What does the deploy script do?");
    expect(emitted.join("")).toBe("");
  });
});

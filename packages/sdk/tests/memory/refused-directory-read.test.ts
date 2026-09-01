import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Agent } from "../../src/index.js";
import { setDiagnosticsSink } from "../../src/internal/diagnostics.js";
import { projectMemoryDir } from "../../src/internal/memory/storage/memory-root.js";

/*
 * #474 — a refused `memory.directory` is silent on the READ path.
 *
 * The write path reports it (#462). The read path wraps everything in `safeCall`, which reports on
 * `diag` — dropped entirely when the host installed no sink. So an app that only CONSUMES memory,
 * which is the served case the `directory` option exists for, answers every turn normally with an
 * empty store and never learns why.
 *
 * The distinction the fix rests on: `safeCall` on the read is right for a corrupt memory file
 * (EC-4) — transient, local to one entry, must not abort the turn. A `ConfigurationError` from the
 * resolver is the opposite: permanent, repeats on every turn forever, and fixable in one line by
 * whoever is being kept in the dark.
 *
 * The sink is CLEARED in these cases on purpose. With one installed `diag` and `diagFailure` both
 * arrive, so a test that kept it would pass against the exact behaviour being fixed.
 */
describe("a memory.directory the resolver refuses", () => {
  let cwd: string;
  let written: string[];
  let realWrite: typeof process.stderr.write;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "refused-dir-"));
    written = [];
    setDiagnosticsSink(undefined);
    realWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
  });
  afterEach(() => {
    process.stderr.write = realWrite;
    setDiagnosticsSink(undefined);
  });

  const agentWith = (directory?: string) =>
    Agent.create({
      model: { id: "anthropic/claude-sonnet-4-6" },
      apiKey: "theo_test_e2e",
      local: { cwd },
      memory: { enabled: true, ...(directory === undefined ? {} : { directory }) },
    });

  it("test_an_ordinary_turn_reports_the_refusal", async () => {
    const agent = await agentWith("./memories");
    await agent.send("What does the deploy script do?");
    expect(written.join("")).toContain("memory.directory");
  });

  /*
   * The condition holds on every turn, so a per-turn warning is a warning somebody turns off —
   * the criterion already applied to #462. Once per agent, like `warnIfMemoryWithoutPermissions`.
   */
  it("test_it_reports_once_and_not_on_every_turn", async () => {
    const agent = await agentWith("./memories");
    for (let i = 0; i < 3; i += 1) await agent.send(`turn ${i}`);
    const hits = written.join("").split("memory.directory").length - 1;
    expect(hits).toBe(1);
  });

  // The accepted input: a valid configuration must stay silent, or the warning fires everywhere.
  it("test_a_valid_directory_says_nothing", async () => {
    const agent = await agentWith(mkdtempSync(join(tmpdir(), "valid-dir-")));
    await agent.send("What does the deploy script do?");
    expect(written.join("")).toBe("");
  });

  it("test_no_directory_configured_says_nothing", async () => {
    const agent = await agentWith();
    await agent.send("What does the deploy script do?");
    expect(written.join("")).toBe("");
  });

  /*
   * An unreadable store degrades to an empty recall and says nothing on the loud channel.
   *
   * Stated honestly, because an earlier version of this case claimed more than it could show: it
   * was written to prove that a NON-configuration failure keeps using the quiet channel, and it
   * cannot. Both readers swallow their own I/O errors and return `[]`
   * (`markdown-store.ts:139-163`), so nothing reaches the catch at all — the case passed with the
   * narrowing removed, which means it was asserting the absence of a throw, not the handling of
   * one. Removing the narrowing is therefore not detectable by any test here, and the code says so
   * where it lives rather than implying a guarantee this suite does not give.
   *
   * What it DOES pin is the boundary that matters to a caller: a store it cannot read costs an
   * empty recall and no noise, which is EC-4's intent.
   */
  it("test_an_unreadable_store_degrades_quietly", async () => {
    // A file where the memory directory must be: the read fails with ENOTDIR, not a config error.
    const { mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(projectMemoryDir(cwd)), { recursive: true });
    writeFileSync(projectMemoryDir(cwd), "not a directory");

    const agent = await agentWith();
    await agent.send("What does the deploy script do?");
    expect(written.join("")).toBe("");
  });
});

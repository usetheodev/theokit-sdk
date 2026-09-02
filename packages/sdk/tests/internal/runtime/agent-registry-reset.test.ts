/**
 * B-117 — regression cover for the autouse reset wired into `vitest.setup.ts`.
 *
 * `agents` in `src/internal/runtime/registry/agent-registry.ts` is a process-wide
 * `Map`, module-level state that lives for as long as the worker process does.
 * `THEOKIT_HOME` isolation (also autouse, in the same setup file) resets everything
 * that touches disk, but never touched this in-memory Map — a probe measured a
 * registry growing 5 → 8 agents across tests in one file before the reset existed.
 *
 * THE PAIRED SHAPE THIS FILE USED TO RELY ON IS GONE, and the reasoning behind it is worth keeping
 * because it was right about the hard part. It was two tests — register in one, assert empty in the
 * next — since the autouse `beforeEach` fires before every test, so the only way to see whether the
 * PREVIOUS registration survived is to look from the next one. A single test that registers and then
 * asserts would pass whether or not any reset ran.
 *
 * What that shape did not survive is order. Its oracle only means anything if the registering test
 * ran first, and this repository runs a shuffle probe (`vitest.shuffle.config.ts`) under which the
 * pair silently stops testing anything: reversed, the empty assertion runs against a registry that
 * was never filled and passes for the wrong reason. A test that cannot fail is worse than no test,
 * and one that stops being able to fail depending on the run order is worse still, because the run
 * where it went quiet looks identical to the run where it worked.
 *
 * The claim is now split into two halves that each hold alone:
 *
 *   1. `clearAgentRegistry()` empties the Map. That is the BEHAVIOUR, and it needs no sibling.
 *   2. `vitest.setup.ts` actually calls it in an autouse hook. That is the WIRING, and it is a
 *      source-scan — the only way to assert a global hook exists without depending on another test.
 *
 * Together they say what the pair said, in any order.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";

import {
  clearAgentRegistry,
  listRegisteredAgents,
  registerAgent,
} from "../../../src/internal/runtime/registry/agent-registry.js";
import { removeTempDirRobustSync } from "../../helpers/temp-workspace.js";

function registerFakeAgent(agentId: string): void {
  // An isolated, never-read cwd: registerAgent schedules a background disk save, and
  // this test only cares about the in-memory Map — the tmpdir keeps that fire-and-forget
  // write off the real project tree, and removeTempDirRobustSync cleans it up.
  const dir = mkdtempSync(join(tmpdir(), "theokit-registry-reset-"));
  onTestFinished(() => {
    removeTempDirRobustSync(dir);
  });
  registerAgent({
    agentId,
    runtime: "local",
    createdAt: Date.now(),
    lastModified: Date.now(),
    archived: false,
    options: {},
    cwd: dir,
  });
}

describe("agent registry reset (B-117)", () => {
  it("test_clearAgentRegistry_empties_the_process_wide_map", () => {
    registerFakeAgent("b117-reset-probe");
    expect(
      listRegisteredAgents(),
      "the fixture has to actually register, or the next line is vacuous",
    ).toHaveLength(1);

    clearAgentRegistry();

    expect(listRegisteredAgents()).toHaveLength(0);
  });

  it("test_vitest_setup_calls_the_reset_in_an_autouse_hook", () => {
    // The wiring half. A global hook cannot be observed from inside a test that the hook already ran
    // for, so this reads the setup file — the same shape other gates in this repo use to assert that
    // a mechanism is installed rather than that it worked once.
    const setup = readFileSync(join(__dirname, "..", "..", "..", "vitest.setup.ts"), "utf8");

    // Statement position, not "the name appears somewhere". Measured while writing this: the file's
    // own docblock contains the words `clearAgentRegistry()` in prose, so a plain `toMatch` passed
    // with the real call deleted — the gate would have gone quiet exactly when it mattered.
    const callSites = setup
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => !line.startsWith("*") && !line.startsWith("//") && !line.startsWith("/*"))
      .filter((line) => /^clearAgentRegistry\(\);/.test(line));

    expect(
      callSites,
      "vitest.setup.ts must CALL clearAgentRegistry(), not merely mention it — without that hook the " +
        "process-wide agent Map leaks across every test in a worker",
    ).toHaveLength(1);
    expect(setup, "from an autouse beforeEach, which is what makes it apply to every test").toMatch(
      /beforeEach\(/,
    );
  });
});

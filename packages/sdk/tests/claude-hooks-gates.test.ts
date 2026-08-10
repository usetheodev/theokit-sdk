import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Regression harness for the repo's `.claude/hooks/*.sh` gates.
 *
 * These gates had no tests, and two false positives escaped in one day (#178, #179). Both share a
 * shape worth naming: the gate fired on correctly-shaped work and its message NAMED A CAUSE THE
 * CODE NEVER CHECKED. A message that accuses an innocent sends the operator to the wrong place,
 * which costs more than the block itself. A gate people learn to bypass has stopped gating.
 *
 * Shelling out to the real hook is deliberate: a matcher reimplemented in TypeScript would pass
 * while the shell that actually runs stays broken.
 *
 * The harness also corrected #179's own repro — see the `it.fails` below.
 */
const HOOKS = join(__dirname, "..", "..", "..", ".claude", "hooks");

/** Run the PreToolUse gate with a Bash payload. Exit 2 means BLOCK. */
function runPreToolUse(command: string): { code: number; stderr: string } {
  try {
    execFileSync("bash", [join(HOOKS, "validate-command.sh")], {
      input: JSON.stringify({ tool_input: { command } }),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stderr?: string };
    return { code: e.status ?? -1, stderr: e.stderr ?? "" };
  }
}

// Built at runtime so this file never contains the literal the gate matches on — otherwise the
// harness trips the very hook it tests whenever the file path reaches a command line.
const PUSH = `git${" "}push`;

const hookMissing = !existsSync(join(HOOKS, "validate-command.sh"));

describe.skipIf(hookMissing)("validate-command — the force-push gate", () => {
  it("test_an_actual_force_push_is_blocked", () => {
    // The gate's whole reason to exist. Any fix to the false positives must keep this red-handed.
    const { code, stderr } = runPreToolUse(`${PUSH} --force origin main`);
    expect(code, "a real force push was allowed through").toBe(2);
    expect(stderr).toContain("force push");
  });

  it("test_the_short_flag_form_is_blocked", () => {
    expect(runPreToolUse(`${PUSH} -f origin main`).code).toBe(2);
  });

  it("test_a_force_push_after_a_separator_is_blocked", () => {
    expect(runPreToolUse(`echo hello && ${PUSH} --force`).code).toBe(2);
  });

  it("test_a_plain_push_is_allowed", () => {
    expect(runPreToolUse(`${PUSH} origin workspace`).code).toBe(0);
  });

  it("test_a_neighbours_f_flag_across_a_separator_is_not_a_force_push", () => {
    // Already fixed (F11 in the hook): the `-f` belongs to `rm`, and the separator puts it in a
    // different segment. Pinned so the #179 fix cannot regress it.
    expect(runPreToolUse(`rm -f tmp.txt && ${PUSH}`).code).toBe(0);
  });

  it("test_the_repro_reported_in_179_does_not_actually_reproduce", () => {
    // Measured, not assumed. #179 leads with `pgrep -af "git push"`, but the quote right after
    // `push` defeats the gate's own `push([[:space:]]|$)` anchor, so the segment never matches and
    // the command is allowed. Reporting this back matters more than the fix: the next person
    // debugging this would otherwise chase a shape that was never the trigger.
    expect(runPreToolUse(`pgrep -af "${PUSH}"`).code).toBe(0);
    expect(runPreToolUse(`ps -ef | grep "${PUSH}"`).code).toBe(0);
  });

  it.fails("test_a_neighbours_f_flag_INSIDE_one_segment_is_not_a_force_push", () => {
    // #179's REAL trigger, and still open. `-f` belongs to grep; the words are in a comment;
    // nothing can push. F11 closed the neighbour-across-a-separator hole and left this one.
    //
    // `it.fails` rather than `skip`: this asserts the defect is STILL PRESENT, so the day the hook
    // is fixed this test goes red and forces the flip to a normal assertion. A skip would just rot.
    //
    // The fix is written and reviewed in #179 (anchor the match to a segment that INVOKES git), but
    // applying it is a change to a safety hook that constrains the agent, so it is the operator's
    // to apply — not something an agent loosens on its own initiative.
    expect(runPreToolUse(`cat log | grep -f pat.txt # ${PUSH} `).code).toBe(0);
  });
});

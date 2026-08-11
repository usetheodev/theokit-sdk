/**
 * Every configuration key should be settable from the environment, or say why not — B-107's second
 * half, in the only shape a framework can honestly own it.
 *
 * A key that can only be set by editing a file cannot be set in CI, in a container, or for one
 * invocation. That is usually an oversight rather than a decision, and it is invisible: nothing
 * fails, the key simply has no environment path and nobody notices until someone needs one.
 *
 * The opposite failure matters as much and rots quietly. An opt-out written for a key that has since
 * gained an environment path, or for a key that no longer exists, reads as a considered decision
 * while exempting nothing — the same way an expired allowlist entry reads as coverage.
 *
 * Generic by the same test as the floor, the fold, the posture and the wiring record: the KEYS, the
 * variable names and the reasons are the caller's, supplied as data. The framework cannot enumerate
 * a consumer's config keys — deliberately, since the keys are the consumer's vocabulary — so what it
 * owns is the RULE, and the consumer ranges over its own keys with it.
 */

import { describe, expect, it } from "vitest";

import { auditEnvReachability } from "../src/env-reachability.js";

const KEYS = ["model", "effort", "skills"];
const REACHABLE = ["model", "effort"];

describe("auditEnvReachability — a key with no way in", () => {
  it("test_a_key_with_neither_an_env_path_nor_an_opt_out_is_reported", () => {
    const audit = auditEnvReachability({ keys: KEYS, reachable: REACHABLE, optOuts: [] });

    expect(audit.unreachable).toEqual(["skills"]);
  });

  it("test_a_key_with_an_env_path_is_not_reported", () => {
    // Anti-vacuity: reporting every key would satisfy the case above.
    const audit = auditEnvReachability({ keys: KEYS, reachable: KEYS, optOuts: [] });

    expect(audit.unreachable).toEqual([]);
  });

  it("test_a_documented_opt_out_exempts_the_key", () => {
    const audit = auditEnvReachability({
      keys: KEYS,
      reachable: REACHABLE,
      optOuts: [
        {
          key: "skills",
          reason: "a list, and every separator is legal in a name",
          exitCriterion: "a request",
        },
      ],
    });

    expect(audit.unreachable).toEqual([]);
  });

  it("test_the_audit_reports_every_unreachable_key_not_only_the_first", () => {
    // A check that stopped at the first gap would report one key, get fixed, and report the next —
    // turning one review into as many rounds as there are gaps.
    const audit = auditEnvReachability({
      keys: ["a", "b", "c"],
      reachable: [],
      optOuts: [],
    });

    expect(audit.unreachable).toEqual(["a", "b", "c"]);
  });
});

describe("auditEnvReachability — an opt-out that exempts nothing", () => {
  it("test_an_opt_out_for_a_key_that_gained_an_env_path_is_reported_stale", () => {
    // The rot this catches. The opt-out still reads as a considered decision, and it now exempts
    // nothing — so the next reader trusts a document that no longer describes the code.
    const audit = auditEnvReachability({
      keys: KEYS,
      reachable: KEYS,
      optOuts: [{ key: "skills", reason: "was a list", exitCriterion: "a request" }],
    });

    expect(audit.staleOptOuts).toEqual(["skills"]);
  });

  it("test_an_opt_out_for_a_key_that_no_longer_exists_is_reported_stale", () => {
    const audit = auditEnvReachability({
      keys: KEYS,
      reachable: REACHABLE,
      optOuts: [{ key: "removed_long_ago", reason: "r", exitCriterion: "e" }],
    });

    expect(audit.staleOptOuts).toEqual(["removed_long_ago"]);
  });

  it("test_an_opt_out_that_does_exempt_something_is_not_reported", () => {
    // Anti-vacuity for the two above: calling every opt-out stale would pass both.
    const audit = auditEnvReachability({
      keys: KEYS,
      reachable: REACHABLE,
      optOuts: [{ key: "skills", reason: "r", exitCriterion: "e" }],
    });

    expect(audit.staleOptOuts).toEqual([]);
  });
});

describe("auditEnvReachability — both questions are answered by one call", () => {
  it("test_a_clean_declaration_reports_nothing_on_either_axis", () => {
    const audit = auditEnvReachability({
      keys: KEYS,
      reachable: REACHABLE,
      optOuts: [{ key: "skills", reason: "r", exitCriterion: "e" }],
    });

    expect(audit).toEqual({ unreachable: [], staleOptOuts: [] });
  });

  it("test_both_axes_report_together_rather_than_one_masking_the_other", () => {
    // One call rather than two, so a consumer cannot check the gap and forget the rot. They fail
    // for opposite reasons and a suite that only asks one question looks complete.
    const audit = auditEnvReachability({
      keys: ["model", "skills"],
      reachable: ["model"],
      optOuts: [{ key: "model", reason: "r", exitCriterion: "e" }],
    });

    expect(audit.unreachable).toEqual(["skills"]);
    expect(audit.staleOptOuts).toEqual(["model"]);
  });

  it("test_an_empty_declaration_is_clean_rather_than_a_throw", () => {
    // A product mid-migration may declare no keys yet, and nothing is wrong with that.
    expect(auditEnvReachability({ keys: [], reachable: [], optOuts: [] })).toEqual({
      unreachable: [],
      staleOptOuts: [],
    });
  });
});

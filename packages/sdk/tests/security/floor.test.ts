/**
 * The floor rule: a lower-trust layer may tighten a security setting and never loosen it.
 *
 * Layered configuration usually resolves last-wins, and for the keys that decide CONFINEMENT that
 * is wrong. With plain precedence, a project layer outranks the user's own file — so a cloned
 * repository can hand itself the most permissive sandbox and the operator's global choice simply
 * loses, silently, at the moment the directory is opened.
 *
 * The rule is generic; the vocabulary is not. Which values count as more permissive, which layers
 * are restricted, and which layer is the operator's explicit override are all the consumer's — so
 * they are parameters. That is the difference between this and a keypress router: here the
 * vocabulary is DATA (two lists and a name), not an open-ended interface shaped by one product.
 *
 * Measured in a consumer before extracting: its own version hard-codes `sandbox_mode` /
 * `approval_policy` orderings and the layer names `project` / `profile` / `env`. None of those
 * belong to a framework; the ordering-and-restriction rule does.
 */

import { describe, expect, it } from "vitest";

import { applySecurityFloor } from "../../src/security-floor.js";

/** A consumer's vocabulary, from most confined to least. */
const SANDBOX = ["read-only", "workspace-write", "danger-full-access"] as const;
const RESTRICTED = ["project", "profile", "env"] as const;

const floor = (layers: Record<string, string | undefined>): string | undefined =>
  applySecurityFloor({
    permissiveness: SANDBOX,
    restricted: RESTRICTED,
    override: "cli",
    layers,
  });

describe("applySecurityFloor — a restricted layer may tighten", () => {
  it("test_a_project_may_harden_what_the_user_chose", () => {
    expect(floor({ user: "workspace-write", project: "read-only" })).toBe("read-only");
  });

  it("test_a_restricted_layer_applies_when_nothing_lower_settled_anything", () => {
    // No ceiling yet: the layer is not loosening anything, it is choosing first.
    expect(floor({ project: "danger-full-access" })).toBe("danger-full-access");
  });

  it("test_the_tightest_restricted_layer_wins_over_a_looser_one", () => {
    expect(
      floor({ user: "danger-full-access", project: "workspace-write", env: "read-only" }),
    ).toBe("read-only");
  });
});

describe("applySecurityFloor — a restricted layer may never loosen", () => {
  it("test_a_project_cannot_widen_the_users_choice", () => {
    // The defect this exists for: a cloned repository handing itself full access.
    expect(floor({ user: "read-only", project: "danger-full-access" })).toBe("read-only");
  });

  it("test_the_environment_cannot_widen_it_either", () => {
    // An inherited environment is no more trusted than a repository — often less, since nobody
    // reviews it.
    expect(floor({ user: "read-only", env: "danger-full-access" })).toBe("read-only");
  });

  it("test_a_loosening_layer_does_not_raise_the_ceiling_for_the_next_one", () => {
    // Order matters: if `project` were allowed to widen, `env` would then be measured against the
    // widened ceiling and could widen further. The ceiling only ever descends.
    expect(
      floor({ user: "read-only", project: "danger-full-access", env: "workspace-write" }),
    ).toBe("read-only");
  });

  it("test_a_hardened_ceiling_descends_and_binds_the_next_restricted_layer", () => {
    // Found by mutation: replacing `ceiling = level` with `Math.max(ceiling, level)` left every
    // other case green. It only differs once a restricted layer HARDENS and a later one offers
    // something between the old and new ceiling — here `project` tightens to read-only, and `env`
    // must then be measured against read-only rather than against the user's danger-full-access.
    expect(
      floor({ user: "danger-full-access", project: "read-only", env: "workspace-write" }),
    ).toBe("read-only");
  });

  it("test_defaults_establish_the_ceiling_when_the_user_said_nothing", () => {
    expect(floor({ defaults: "read-only", project: "danger-full-access" })).toBe("read-only");
  });

  it("test_the_user_layer_outranks_defaults_as_the_ceiling", () => {
    // The user may loosen their own default — they are not a restricted layer.
    expect(
      floor({ defaults: "read-only", user: "workspace-write", project: "danger-full-access" }),
    ).toBe("workspace-write");
  });
});

describe("applySecurityFloor — the operator's explicit override", () => {
  it("test_the_override_wins_outright_in_both_directions", () => {
    // The threat model is a repository or an inherited environment, not the person at the keyboard
    // typing a flag for one session.
    expect(floor({ user: "read-only", cli: "danger-full-access" })).toBe("danger-full-access");
    expect(floor({ user: "danger-full-access", cli: "read-only" })).toBe("read-only");
  });

  it("test_the_override_wins_even_over_a_restricted_layer_that_hardened", () => {
    expect(
      floor({ user: "workspace-write", project: "read-only", cli: "danger-full-access" }),
    ).toBe("danger-full-access");
  });
});

describe("applySecurityFloor — values outside the vocabulary", () => {
  it("test_an_unknown_value_in_a_restricted_layer_is_ignored", () => {
    // A typo in a repository's config must not silently become the effective setting, and must not
    // be treated as maximally permissive either.
    expect(floor({ user: "read-only", project: "sandbox-mode-typo" })).toBe("read-only");
  });

  it("test_an_unknown_value_in_the_override_is_still_honoured", () => {
    // The override is deliberately not validated here: validating the operator's flag is the
    // consumer's job and it owns the error message. Silently dropping it would be worse.
    expect(floor({ user: "read-only", cli: "whatever-the-consumer-allows" })).toBe(
      "whatever-the-consumer-allows",
    );
  });

  it("test_nothing_configured_anywhere_resolves_to_undefined", () => {
    expect(floor({})).toBeUndefined();
  });
});

describe("applySecurityFloor — the vocabulary is the caller's", () => {
  it("test_a_different_ordering_and_different_layer_names_work", () => {
    // The point of extracting this. A second product with its own modes and its own layer names
    // gets the rule without inheriting this one's words.
    const result = applySecurityFloor({
      permissiveness: ["strict", "normal", "permissive"],
      restricted: ["repo"],
      override: "flag",
      layers: { user: "strict", repo: "permissive" },
    });

    expect(result).toBe("strict");
  });

  it("test_a_layer_not_named_restricted_may_loosen", () => {
    // Anti-vacuity: if every layer were treated as restricted, the cases above would pass while the
    // function refused all widening, which is not the rule.
    const result = applySecurityFloor({
      permissiveness: ["strict", "normal", "permissive"],
      restricted: ["repo"],
      override: "flag",
      layers: { user: "strict", somethingElse: "permissive" },
    });

    expect(result).toBe("permissive");
  });
});

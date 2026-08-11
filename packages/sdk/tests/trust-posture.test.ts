/**
 * The trust posture — B-097's third slice, and the one B-108 waits on.
 *
 * A product that reads a project directory must decide what a repository is allowed to switch on:
 * its hooks (arbitrary command execution on every tool call), its MCP servers (external processes
 * SPAWNED while the agent is built, before any per-tool approval), its instructions. Getting that
 * wrong grants local execution on first build.
 *
 * The arithmetic is small. The value is the INVARIANT: untrusted means every declared capability is
 * off, and `allows` is built FROM the declared list so a product that adds a ninth capability
 * cannot forget to gate it — the failure that is invisible, because the new capability simply works
 * in a directory where it should not.
 *
 * Generic by the same test as the floor and the fold: the capability KEYS, the environment override
 * and the store lookup are all the caller's, supplied as data or as a function.
 */

import { describe, expect, it } from "vitest";

import { resolveTrustPosture } from "../src/trust-posture.js";

const CAPS = ["hooks", "mcp", "skills"] as const;

describe("resolveTrustPosture — untrusted withholds everything", () => {
  it("test_the_default_is_untrusted_and_grants_nothing", () => {
    // The safe direction, and the one a product gets by doing nothing.
    const posture = resolveTrustPosture({ capabilities: CAPS, isTrusted: () => false });

    expect(posture.level).toBe("untrusted");
    expect(posture.source).toBe("default");
    expect(posture.allows).toEqual({ hooks: false, mcp: false, skills: false });
  });

  it("test_every_declared_capability_is_present_in_allows", () => {
    // The invariant that makes forgetting impossible: `allows` is built from the declared list, so
    // a capability that exists cannot be missing from the gate.
    const posture = resolveTrustPosture({ capabilities: CAPS, isTrusted: () => false });
    expect(Object.keys(posture.allows).sort()).toEqual(["hooks", "mcp", "skills"]);
  });

  it("test_no_capability_appears_that_was_not_declared", () => {
    // The other half. A gate that invented keys would let a consumer read `allows.somethingElse`
    // as `undefined` and treat it as falsy by accident rather than by decision.
    const posture = resolveTrustPosture({ capabilities: ["hooks"], isTrusted: () => true });
    expect(Object.keys(posture.allows)).toEqual(["hooks"]);
  });
});

describe("resolveTrustPosture — where trust comes from", () => {
  it("test_a_trusted_store_grants_everything_and_says_so", () => {
    const posture = resolveTrustPosture({ capabilities: CAPS, isTrusted: () => true });

    expect(posture.level).toBe("trusted");
    expect(posture.source).toBe("store");
    expect(posture.allows).toEqual({ hooks: true, mcp: true, skills: true });
  });

  it("test_an_environment_override_grants_trust_and_is_reported_as_env", () => {
    // Reported separately from `store` because they are different facts: one is a decision the
    // operator recorded per directory, the other is a blanket switch. A surface that shows "trusted"
    // without saying which cannot warn about the blanket one.
    const posture = resolveTrustPosture({
      capabilities: CAPS,
      isTrusted: () => false,
      envOverride: true,
    });

    expect(posture.level).toBe("trusted");
    expect(posture.source).toBe("env");
  });

  it("test_the_environment_override_outranks_the_store", () => {
    const posture = resolveTrustPosture({
      capabilities: CAPS,
      isTrusted: () => true,
      envOverride: true,
    });
    expect(posture.source).toBe("env");
  });

  it("test_an_override_of_false_does_not_grant_trust_by_itself", () => {
    // `envOverride: false` means "the operator did not switch it on", not "the operator switched it
    // off". Treating it as a decision would make an unset variable override a trusted store.
    const posture = resolveTrustPosture({
      capabilities: CAPS,
      isTrusted: () => true,
      envOverride: false,
    });

    expect(posture.level).toBe("trusted");
    expect(posture.source).toBe("store");
  });

  it("test_the_store_lookup_is_called_once", () => {
    // It can touch the filesystem. Calling it per capability would multiply the cost by the size of
    // a list the consumer controls.
    let calls = 0;
    resolveTrustPosture({
      capabilities: CAPS,
      isTrusted: () => {
        calls += 1;
        return false;
      },
    });
    expect(calls).toBe(1);
  });

  it("test_the_store_lookup_is_not_called_when_the_environment_already_granted_trust", () => {
    // Nothing left to decide, and the lookup may be I/O.
    let calls = 0;
    resolveTrustPosture({
      capabilities: CAPS,
      isTrusted: () => {
        calls += 1;
        return true;
      },
      envOverride: true,
    });
    expect(calls).toBe(0);
  });
});

describe("resolveTrustPosture — degenerate input", () => {
  it("test_no_declared_capabilities_yields_a_posture_that_grants_nothing", () => {
    // Still a valid posture rather than a throw: a product mid-migration may declare none yet, and
    // granting nothing is the safe reading of an empty list.
    const posture = resolveTrustPosture({ capabilities: [], isTrusted: () => true });

    expect(posture.level).toBe("trusted");
    expect(posture.allows).toEqual({});
  });

  it("test_a_duplicated_capability_key_does_not_produce_conflicting_entries", () => {
    const posture = resolveTrustPosture({
      capabilities: ["hooks", "hooks"],
      isTrusted: () => true,
    });
    expect(posture.allows).toEqual({ hooks: true });
  });
});

/**
 * B-096 — refusing to destroy a session another process is still writing.
 *
 * Every agent product that lets a user delete a session needs this guard, and the failure is
 * unrecoverable in the worst way: a transcript deleted underneath a running session takes with it
 * everything that session had not flushed, and nothing errors. The user sees a successful delete.
 *
 * ## What the ordering is for
 *
 * The check must run BEFORE anything is mutated. Removing the registry entry and then refusing
 * leaves a session that can be neither opened nor deleted — worse than either outcome alone. So the
 * guard is a function the caller must pass through, not a flag it may consult afterwards, and its
 * throw is what stops the mutation.
 *
 * ## What is generic, and what is not
 *
 * The RULE is: a session is protected when it is one the product declares live, and destroying a
 * protected session throws a typed error NAMING it. The VOCABULARY is not — how a product decides
 * which sessions are live (a pointer file, the newest transcript, a lease, a registry) is its own,
 * and arrives as data. Nothing here reads a filesystem.
 */

import { describe, expect, it } from "vitest";

import { guardSessionDestruction, LiveSessionError } from "../src/session-guard.js";

describe("guardSessionDestruction — a live session is refused", () => {
  it("test_destroying_a_live_session_throws", () => {
    expect(() => guardSessionDestruction("s1", ["s1", "s2"])).toThrow(LiveSessionError);
  });

  it("test_the_error_names_the_session", () => {
    // A refusal that does not say WHICH session leaves the user guessing which of their sessions to
    // switch away from.
    try {
      guardSessionDestruction("s1", ["s1"]);
      throw new Error("expected a throw");
    } catch (err) {
      expect((err as Error).message).toContain("s1");
      expect((err as LiveSessionError).sessionId).toBe("s1");
    }
  });

  it("test_destroying_a_session_that_is_not_live_returns", () => {
    // Anti-vacuity: refusing everything would satisfy both cases above and make delete impossible.
    expect(() => guardSessionDestruction("s3", ["s1", "s2"])).not.toThrow();
  });
});

describe("guardSessionDestruction — an unknown live set fails closed", () => {
  it("test_an_empty_live_set_still_permits_deletion", () => {
    // Empty is a legitimate answer: a directory with no sessions open has none live. This is the
    // one place the safe default is NOT refusal, and it is why `unknown` exists separately below.
    expect(() => guardSessionDestruction("s1", [])).not.toThrow();
  });

  it("test_a_live_set_that_could_not_be_determined_refuses", () => {
    // The defect this shape prevents. A product that swallowed a read error and returned `[]` would
    // hand this guard an empty set — the one input that disables it entirely — on exactly the path
    // that destroys data. `undefined` says "could not determine", and that refuses.
    expect(() => guardSessionDestruction("s1", undefined)).toThrow(LiveSessionError);
  });

  it("test_the_undetermined_refusal_says_so_rather_than_claiming_the_session_is_live", () => {
    // Two different facts, two different fixes: "close that session" versus "the guard could not
    // read". Telling the user the first when it was the second sends them to close nothing.
    try {
      guardSessionDestruction("s1", undefined);
      throw new Error("expected a throw");
    } catch (err) {
      expect((err as LiveSessionError).reason).toBe("liveness-undetermined");
    }
  });

  it("test_a_live_session_reports_a_different_reason_than_an_undetermined_one", () => {
    try {
      guardSessionDestruction("s1", ["s1"]);
      throw new Error("expected a throw");
    } catch (err) {
      expect((err as LiveSessionError).reason).toBe("session-is-live");
    }
  });
});

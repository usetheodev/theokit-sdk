/**
 * B-099 — a reporting surface answers whether a credential EXISTS, never what it is.
 *
 * Every agent product grows a "why can't I use this model?" surface — a doctor command, a status
 * panel, a startup diagnostic. Each one needs to know whether a credential resolved, and each one
 * is one careless line away from printing it. The line is careless precisely because it is
 * convenient: the value is right there, and a developer debugging a routing problem wants to see it.
 *
 * Making presence-only the framework's DEFAULT rather than each consumer's discipline is the whole
 * point of the second DoD bullet. Discipline is what every product has until the day it does not.
 *
 * ## What is generic, and what is not
 *
 * The RULE is: resolve model to a credential, report presence and provenance, never the secret. The
 * VOCABULARY is not — which providers exist, how a model name maps to one, and where credentials
 * live all belong to the product and arrive as data. Nothing here knows a provider's name.
 */

import { describe, expect, it } from "vitest";

import { describeCredential } from "../src/credential-presence.js";

const SECRET = "sk-live-000111222333";

describe("describeCredential — presence, never the value", () => {
  it("test_a_resolved_credential_is_reported_as_present", () => {
    const report = describeCredential({ provider: "acme", value: SECRET, source: "env" });

    expect(report.present).toBe(true);
    expect(report.provider).toBe("acme");
    expect(report.source).toBe("env");
  });

  it("test_the_secret_appears_nowhere_in_the_report", () => {
    // The line that matters. Serialised, because that is how a report reaches a log, a panel or a
    // support bundle — and a field a human would not print is one `JSON.stringify` away from a file.
    const report = describeCredential({ provider: "acme", value: SECRET, source: "env" });

    expect(JSON.stringify(report)).not.toContain(SECRET);
    expect(Object.values(report).join(" ")).not.toContain(SECRET);
  });

  it("test_a_missing_credential_is_reported_as_absent_with_its_provider", () => {
    // Absence must still name the provider: "no credential" without saying for WHAT sends the user
    // to check the wrong one.
    const report = describeCredential({ provider: "acme", value: undefined, source: "env" });

    expect(report.present).toBe(false);
    expect(report.provider).toBe("acme");
  });

  it("test_an_empty_string_is_absent_rather_than_present", () => {
    // The shape that breaks naive checks. An unset environment variable read through a shell
    // expansion arrives as "", and treating it as present reports a working credential where there
    // is none — the same failure B-118 measured with an npm token.
    expect(describeCredential({ provider: "acme", value: "", source: "env" }).present).toBe(false);
  });

  it("test_whitespace_only_is_absent_too", () => {
    expect(describeCredential({ provider: "acme", value: "  \n", source: "env" }).present).toBe(
      false,
    );
  });
});

describe("describeCredential — a fingerprint, not a preview", () => {
  it("test_a_present_credential_carries_a_short_stable_fingerprint", () => {
    // What makes a report actionable without leaking: two people comparing "is it the same key?"
    // need something, and a prefix of the secret is still the secret.
    const a = describeCredential({ provider: "acme", value: SECRET, source: "env" });
    const b = describeCredential({ provider: "acme", value: SECRET, source: "file" });

    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toHaveLength(8);
  });

  it("test_different_secrets_fingerprint_differently", () => {
    const a = describeCredential({ provider: "acme", value: SECRET, source: "env" });
    const b = describeCredential({ provider: "acme", value: `${SECRET}x`, source: "env" });

    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("test_the_fingerprint_is_not_a_prefix_of_the_secret", () => {
    // Anti-vacuity, and the mistake this exists to refuse: `value.slice(0, 8)` would satisfy both
    // cases above while publishing the first eight characters of a live key.
    const report = describeCredential({ provider: "acme", value: SECRET, source: "env" });

    expect(SECRET).not.toContain(report.fingerprint ?? "");
  });

  it("test_an_absent_credential_has_no_fingerprint", () => {
    expect(
      describeCredential({ provider: "acme", value: undefined, source: "env" }).fingerprint,
    ).toBeUndefined();
  });
});

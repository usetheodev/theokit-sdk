/**
 * Tests for the public `Security` namespace (T2.1, ADR D68).
 */

import { describe, expect, it } from "vitest";

import { Security } from "../src/index.js";
import { redactSecrets } from "../src/internal/security/index.js";

describe("Security.addPattern (public API)", () => {
  it("rejects regex without /g flag", () => {
    expect(() => Security.addPattern(/CUSTOM-[A-Z]{4}/)).toThrow(/\/g flag/);
  });

  it("accepts regex with /g and masks custom secrets in subsequent redact calls", () => {
    Security.addPattern(/MYORG-[A-Z0-9]{16}/g);
    const custom = `MYORG-${"A".repeat(16)}`;
    const out = redactSecrets(`token: ${custom}`);
    expect(out).not.toContain(custom);
  });

  it("does not affect built-in patterns", () => {
    Security.addPattern(/ZZZNEW-[A-Z]{8}/g);
    expect(redactSecrets("key=sk-abcdef0123456789ghijklmn")).not.toContain(
      "sk-abcdef0123456789ghijklmn",
    );
  });
});

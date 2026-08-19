/**
 * Tests for the canonical secret-redaction module (T0.1, ADRs D68-D73).
 *
 * 23 cases per plan: 21 base + EC-1 circular + EC-3 vitest reset wire.
 */

import { describe, expect, it } from "vitest";
import { addPattern, maskToken, redactSecrets } from "../../../src/internal/security/index.js";
import { _resetForTests } from "../../../src/internal/security/test-reset.js";

describe("redactSecrets — inputs", () => {
  it("returns '' for undefined", () => {
    expect(redactSecrets(undefined)).toBe("");
  });

  it("returns '' for null", () => {
    expect(redactSecrets(null)).toBe("");
  });

  it("coerces a plain object via JSON.stringify", () => {
    expect(redactSecrets({ hello: "world" })).toBe('{"hello":"world"}');
  });

  it("returns '' for empty string", () => {
    expect(redactSecrets("")).toBe("");
  });

  it("coerces non-string scalar via String()", () => {
    expect(redactSecrets(42)).toBe("42");
  });

  // EC-1 fix: circular references must NOT throw.
  it("returns sentinel for circular references — does not throw", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(redactSecrets(obj)).toBe("[unredactable: circular]");
  });
});

describe("redactSecrets — builtin patterns mask correctly", () => {
  it("masks OpenAI sk- with 20+ char body, preserves prefix+suffix", () => {
    const secret = "sk-abcdefghij1234567890wxyz";
    const out = redactSecrets(`key=${secret}`);
    expect(out).not.toContain(secret);
    // length 27 → bucket "long" → prefix/suffix preserved
    expect(out).toContain("sk-abc");
    expect(out).toContain("wxyz");
  });

  it("masks sk-ant- BEFORE generic sk-", () => {
    const secret = "sk-ant-abcdefghij1234567890";
    const out = redactSecrets(`auth: ${secret}`);
    expect(out).not.toContain(secret);
    expect(out).toContain("sk-ant");
  });

  it("masks sk-proj- BEFORE generic sk-", () => {
    const secret = "sk-proj-abcdefghij1234567890";
    const out = redactSecrets(`auth: ${secret}`);
    expect(out).not.toContain(secret);
    expect(out).toContain("sk-pro");
  });

  it("masks AKIA AWS key", () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const out = redactSecrets(`aws=${secret}`);
    expect(out).not.toContain(secret);
  });

  it("masks ghp_ GitHub PAT classic at exact 36-char length", () => {
    const secret = `ghp_${"a".repeat(36)}`;
    const out = redactSecrets(`token=${secret}`);
    expect(out).not.toContain(secret);
  });
});

describe("redactSecrets — PARAM_PATTERN", () => {
  it("masks Authorization: Bearer <token>", () => {
    const out = redactSecrets("Authorization: Bearer eyJabc.def.ghi");
    expect(out).not.toContain("eyJabc.def.ghi");
    expect(out).toContain("Authorization: Bearer ***");
  });

  it("masks access_token= in URL", () => {
    const out = redactSecrets("https://api.example.com?access_token=xyz12345");
    expect(out).not.toContain("xyz12345");
    expect(out).toMatch(/access_token=\*\*\*/);
  });

  it("masks api_key= in JSON-like body", () => {
    const out = redactSecrets('{ "api_key": "abc123def456" }');
    expect(out).not.toContain("abc123def456");
  });

  // issue #117 (review Finding) — regression lock for the EXACT leak case: a real secret whose
  // value contains `...` used to be skipped by the "already-masked" guard and returned verbatim.
  it("issue #117: masks a real secret whose value contains '...' (not skipped)", () => {
    const secret = "L_-cxw-.2UI_..._";
    const out = redactSecrets(`access_token=${secret}`);
    expect(out).not.toContain(secret);
    expect(out).toMatch(/access_token=\*\*\*/);
  });

  // The complementary invariant: an ALREADY-masked value (exact maskToken shape) is not re-masked.
  it("issue #117: leaves an already-masked value (6chars...4chars) untouched", () => {
    const masked = maskToken("abcdef0123456789wxyz"); // -> "abcdef...wxyz"
    const out = redactSecrets(`access_token=${masked}`);
    expect(out).toContain(masked);
  });

  it("with codeFile: true SKIPS PARAM_PATTERN", () => {
    // codeFile mode preserves env-example placeholders like "sk-test"
    // (under the 10-char body floor for the builtin sk- pattern) AND
    // skips PARAM_PATTERN that would otherwise mask `OPENAI_API_KEY=`.
    const sample = "OPENAI_API_KEY=sk-test";
    const out = redactSecrets(sample, { codeFile: true });
    expect(out).toContain("sk-test");
    expect(out).toContain("OPENAI_API_KEY=");
  });
});

describe("redactSecrets — disabled state", () => {
  it("is no-op when REDACT_ENABLED=false", () => {
    _resetForTests({ enabled: false });
    try {
      const secret = "sk-abcdefghij1234567890wxyz";
      expect(redactSecrets(`key=${secret}`)).toContain(secret);
    } finally {
      _resetForTests({ enabled: true });
    }
  });
});

describe("addPattern", () => {
  it("with /g flag accepts; without /g throws", () => {
    expect(() => addPattern(/MYORG-[A-Z0-9]{32}/)).toThrow(/\/g flag/);
    expect(() => addPattern(/MYORG-[A-Z0-9]{32}/g)).not.toThrow();
  });

  it("is additive — adding custom pattern masks it without affecting builtins", () => {
    addPattern(/MYORG-[A-Z0-9]{32}/g);
    const customSecret = `MYORG-${"A".repeat(32)}`;
    const out = redactSecrets(`token: ${customSecret} key=sk-abcdefghij1234567890`);
    expect(out).not.toContain(customSecret);
    // builtins still work
    expect(out).not.toContain("sk-abcdefghij1234567890");
  });
});

describe("maskToken", () => {
  it("short token returns ***", () => {
    expect(maskToken("short")).toBe("***");
  });

  it("long token returns prefix+suffix", () => {
    // 22 chars → prefix slice(0,6)="sk-abc" + suffix slice(-4)="0xyz"
    expect(maskToken("sk-abcdef1234567890xyz")).toBe("sk-abc...0xyz");
  });
});

describe("_resetForTests", () => {
  it("flips REDACT_ENABLED", () => {
    _resetForTests({ enabled: false });
    expect(redactSecrets("sk-abcdefghij1234567890wxyz")).toContain("sk-abcdefghij");
    _resetForTests({ enabled: true });
    expect(redactSecrets("sk-abcdefghij1234567890wxyz")).not.toContain(
      "sk-abcdefghij1234567890wxyz",
    );
  });

  it("clearExtras removes patterns added via addPattern", () => {
    addPattern(/CUSTOM-[A-Z]{8}/g);
    expect(redactSecrets("CUSTOM-ABCDEFGH")).not.toContain("CUSTOM-ABCDEFGH");
    _resetForTests({ clearExtras: true });
    expect(redactSecrets("CUSTOM-ABCDEFGH")).toContain("CUSTOM-ABCDEFGH");
  });
});

describe("vitest.setup.ts wire (EC-3 fix)", () => {
  // B-011, second attempt. The original pair was genuinely order-dependent: test B asserted the
  // pattern was gone, which is true by default whenever A never ran, so B passed alone and passed
  // with A deleted. That part of the criticism stands.
  //
  // My first replacement then threw the baby out. Review measured it: with `_resetForTests` deleted
  // from vitest.setup.ts:78, the whole 4465-test suite stayed green — the EC-3 wire could be removed
  // and nothing would notice. Worse, my replacement was a near-verbatim duplicate of
  // "clearExtras removes patterns added via addPattern" thirteen lines above, so it had zero unique
  // killing power while its comment claimed it covered the setup file. And the justification I wrote
  // for deleting old B — that it "would have passed if the reset were removed entirely" — was simply
  // false: old B killed that mutant. The ordering defect was real; discarding the coverage was not
  // the fix for it.
  //
  // Two SYMMETRIC halves instead. Each asserts the probe is NOT redacted on entry, then adds the
  // pattern. Whichever runs second, its entry assertion is load-bearing — the only thing that can
  // have removed the pattern the other half added is the setup file's beforeEach. Neither half
  // depends on a SPECIFIC order: any order covers the wire, which is what separates this from the
  // pair it replaces.
  const PROBE = "EC3-ABCDEFGH";

  /** Assert nothing leaked into this test, then deliberately leave a pattern behind for the sibling. */
  function assertCleanEntryThenDirty(): void {
    expect(
      redactSecrets(PROBE),
      "a runtime pattern leaked past the setup file's beforeEach",
    ).toContain(PROBE);

    addPattern(/EC3-[A-Z]{8}/g);
    expect(
      redactSecrets(PROBE),
      "the pattern must take effect, or the sibling's entry check proves nothing",
    ).not.toContain(PROBE);
  }

  it("test_no_runtime_pattern_survives_into_this_test_first_half", () => {
    assertCleanEntryThenDirty();
  });

  it("test_no_runtime_pattern_survives_into_this_test_second_half", () => {
    assertCleanEntryThenDirty();
  });
});

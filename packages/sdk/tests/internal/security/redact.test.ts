/**
 * Tests for the canonical secret-redaction module (T0.1, ADRs D68-D73).
 *
 * 23 cases per plan: 21 base + EC-1 circular + EC-3 vitest reset wire.
 */

import { describe, expect, it } from "vitest";

import { _resetForTests } from "../../../src/internal/security/_test-reset.js";
import { addPattern, maskToken, redactSecrets } from "../../../src/internal/security/index.js";

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
  // Test A: add a pattern, verify it works in this test.
  it("A: adding pattern works inside test", () => {
    addPattern(/EC3-[A-Z]{8}/g);
    expect(redactSecrets("EC3-ABCDEFGH")).not.toContain("EC3-ABCDEFGH");
  });

  // Test B: pattern from test A must NOT be present (cleared by beforeEach).
  it("B: pattern from previous test cleared by vitest.setup.ts beforeEach", () => {
    expect(redactSecrets("EC3-ABCDEFGH")).toContain("EC3-ABCDEFGH");
  });
});

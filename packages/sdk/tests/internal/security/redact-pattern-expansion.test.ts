/**
 * T5.4 — Redactor pattern expansion (12 → 30+ builtin patterns).
 *
 * Pre-T5.4 the canonical redactor at `internal/security/redact.ts:48-63`
 * shipped only 12 vendor-specific builtin patterns: Anthropic / OpenAI /
 * OpenAI-project / GitHub PAT (classic + fine-grained) / GitLab / AWS /
 * Google API / Slack / Sentry / Stripe (live + restricted). DR6 finding
 * #4 + #24 surfaced major vendor classes that leaked through:
 *
 * - JWT (3-segment base64url) — pervasive across auth headers
 * - GCP service-account private_key PEM block (catastrophic if leaked)
 * - Azure Storage SAS signature
 * - HuggingFace personal access tokens
 * - Perplexity / Groq / Replicate / Voyage / xAI / Fireworks / Pinecone
 *   per-vendor tokens (each well-documented prefix)
 * - Anthropic admin keys (separate prefix from regular sk-ant-)
 *
 * T5.4 expands BUILTIN_PATTERNS to ≥ 30 and extends PARAM_PATTERN keyword
 * coverage so generic `token=`, `bearer=`, `credential=`, `refresh_token=`,
 * `client_secret=`, `jwt=`, `auth=` get masked too. Additive only — every
 * pre-existing pattern is preserved.
 */

import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../../src/internal/security/index.js";
import { __TESTING__BUILTIN_PATTERN_COUNT } from "../../../src/internal/security/test-reset.js";

describe("T5.4 — builtin pattern count expanded", () => {
  it("ships at least 30 builtin patterns (was 12 pre-T5.4)", () => {
    expect(__TESTING__BUILTIN_PATTERN_COUNT()).toBeGreaterThanOrEqual(30);
  });
});

describe("T5.4 — new vendor-prefix patterns redact correctly", () => {
  it("masks JWT (3-segment base64url)", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const out = redactSecrets(`token=${jwt}`);
    // BUILTIN masks the JWT in D71 prefix+`...`+suffix form — the
    // secret middle (payload + signature) is gone, the prefix (header)
    // is preserved for debuggability.
    expect(out).not.toContain(jwt);
    expect(out).toContain("...");
  });

  it("masks GCP service-account PEM private_key block", () => {
    const pem =
      "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----";
    const out = redactSecrets(`{"private_key": "${pem}"}`);
    expect(out).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAAS");
  });

  it("masks HuggingFace personal access token (hf_ prefix)", () => {
    const hf = "hf_abcdefghijklmnopqrstuvwxyzABCD0123";
    const out = redactSecrets(`Authorization: Bearer ${hf}`);
    expect(out).not.toContain(hf);
  });

  it("masks Anthropic admin key (sk-ant-admin01 prefix)", () => {
    const admin = "sk-ant-admin01-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const out = redactSecrets(admin);
    expect(out).not.toContain(admin);
    expect(out).toContain("sk-ant"); // prefix preserved by two-bucket mask
  });

  it("masks Groq token (gsk_ prefix)", () => {
    const gsk = "gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789AB";
    const out = redactSecrets(gsk);
    expect(out).not.toContain(gsk);
  });

  it("masks Perplexity token (pplx- prefix)", () => {
    const pplx = "pplx-abcdefghijklmnopqrstuvwxyzABCDEFGHIJ";
    const out = redactSecrets(pplx);
    expect(out).not.toContain(pplx);
  });

  it("masks Replicate token (r8_ prefix)", () => {
    const r8 = "r8_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLM";
    const out = redactSecrets(r8);
    expect(out).not.toContain(r8);
  });

  it("masks xAI token (xai- prefix)", () => {
    const xai = "xai-abcdefghijklmnopqrstuvwxyzABCDEFGHIJ";
    const out = redactSecrets(xai);
    expect(out).not.toContain(xai);
  });

  it("masks Fireworks token (fw_ prefix)", () => {
    const fw = "fw_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ";
    const out = redactSecrets(fw);
    expect(out).not.toContain(fw);
  });

  it("masks Voyage AI token (pa- prefix)", () => {
    const voyage = "pa-abcdefghijklmnopqrstuvwxyzABCDEFGH";
    const out = redactSecrets(voyage);
    expect(out).not.toContain(voyage);
  });

  it("masks Pinecone API key (pcsk_ prefix)", () => {
    const pc = "pcsk_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ";
    const out = redactSecrets(pc);
    expect(out).not.toContain(pc);
  });

  it("masks Azure Storage SAS signature parameter (sig=)", () => {
    const sas =
      "https://acct.blob.core.windows.net/c?sv=2020-08-04&sig=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234567890%2BabCD%2F";
    const out = redactSecrets(sas);
    expect(out).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef1234567890");
  });
});

describe("T5.4 — PARAM_PATTERN keyword expansion", () => {
  it("masks token=<value>", () => {
    const out = redactSecrets("token=longvaluehere1234567");
    expect(out).not.toContain("longvaluehere1234567");
    expect(out).toMatch(/token=\*+|token=\*\*\*/);
  });

  it("masks refresh_token=<value>", () => {
    const out = redactSecrets("refresh_token=somelong-refresh-token-value-12345");
    expect(out).not.toContain("somelong-refresh-token-value-12345");
  });

  it("masks client_secret=<value>", () => {
    const out = redactSecrets("client_secret=oauth_client_secret_value_abc123");
    expect(out).not.toContain("oauth_client_secret_value_abc123");
  });

  it("masks credential=<value>", () => {
    const out = redactSecrets('"credential": "vendor_credential_payload_xyz"');
    expect(out).not.toContain("vendor_credential_payload_xyz");
  });

  it("masks session_token=<value>", () => {
    const out = redactSecrets("session_token=some-session-token-value");
    expect(out).not.toContain("some-session-token-value");
  });

  it("masks jwt=<value>", () => {
    const out = redactSecrets("jwt=eyJh.eyJz.SflK");
    expect(out).not.toContain("eyJh.eyJz.SflK");
  });
});

describe("T5.4 — pre-existing patterns continue to work (regression)", () => {
  it("still masks sk-ant-* (Anthropic)", () => {
    const ant = "sk-ant-abcdefghijklmnopqrstuvwxyz0123456789";
    expect(redactSecrets(ant)).not.toContain(ant);
  });

  it("still masks AKIA* (AWS access key)", () => {
    const aws = "AKIA1234567890ABCDEF";
    expect(redactSecrets(aws)).not.toContain(aws);
  });

  it("still masks ghp_* (GitHub PAT classic)", () => {
    const gh = "ghp_abcdefghij1234567890ABCDEFGHIJ1234ab";
    expect(redactSecrets(gh)).not.toContain(gh);
  });

  it("still masks api_key=<value>", () => {
    const out = redactSecrets("api_key=secretkeyvaluehere");
    expect(out).not.toContain("secretkeyvaluehere");
  });
});

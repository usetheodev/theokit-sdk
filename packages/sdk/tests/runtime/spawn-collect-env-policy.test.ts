import { describe, expect, it } from "vitest";
import { resolveChildEnv } from "../../src/internal/runtime/lifecycle/env-policy.js";

/**
 * #54 — child processes inherited the FULL `process.env` (secrets included).
 * `resolveChildEnv` computes the env a child receives under a policy:
 *   - `inherit-scrubbed` (default): inherit all parent env MINUS secret-like keys
 *   - `all`: opt-out — inherit everything (previous behavior, explicit)
 *   - `core`: allowlist of safe base vars + explicit adds
 * Explicit `overrides` always win (a tool can re-inject a var it truly needs).
 *
 * RED (pre-fix): the module does not exist → import fails.
 */
describe("resolveChildEnv env policy (#54)", () => {
  const parent = {
    PATH: "/usr/bin",
    HOME: "/home/u",
    PUBLIC_BASE_URL: "https://example.com",
    FAKE_SECRET_TOKEN: "s3cr3t",
    API_KEY: "ak",
    X_SECRET: "xs",
    GH_TOKEN: "ght",
    DB_PASSWORD: "pw",
  };

  it("scrubs secret-like vars by default (inherit-scrubbed)", () => {
    const env = resolveChildEnv({ parent });
    expect(env.FAKE_SECRET_TOKEN).toBeUndefined();
    expect(env.API_KEY).toBeUndefined();
    expect(env.X_SECRET).toBeUndefined();
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.DB_PASSWORD).toBeUndefined();
  });

  it("keeps non-secret vars including PATH (EC-4: no false positive)", () => {
    const env = resolveChildEnv({ parent });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/u");
    expect(env.PUBLIC_BASE_URL).toBe("https://example.com");
  });

  it("policy 'all' opts out — preserves secrets (explicit contract)", () => {
    const env = resolveChildEnv({ parent, policy: "all" });
    expect(env.FAKE_SECRET_TOKEN).toBe("s3cr3t");
    expect(env.API_KEY).toBe("ak");
  });

  it("EC-3: explicit overrides re-inject a scrubbed secret", () => {
    const env = resolveChildEnv({ parent, overrides: { API_KEY: "explicit" } });
    expect(env.API_KEY).toBe("explicit");
  });

  it("SEC-M0-02: drops additional secret conventions (credentials/passwd/pwd/passphrase/private)", () => {
    const env = resolveChildEnv({
      parent: {
        PATH: "/usr/bin",
        PWD: "/home/u", // shell working-dir — MUST be kept (bare PWD is not a secret)
        GOOGLE_APPLICATION_CREDENTIALS: "/etc/gcp/sa.json",
        DB_PWD: "p",
        SSH_PASSPHRASE: "p",
        MY_PRIVATE: "p",
        VAULT_CREDENTIAL: "p",
        PGPASSWD: "p",
      },
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.PWD).toBe("/home/u"); // not dropped — bare PWD is the shell cwd
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
    expect(env.DB_PWD).toBeUndefined();
    expect(env.SSH_PASSPHRASE).toBeUndefined();
    expect(env.MY_PRIVATE).toBeUndefined();
    expect(env.VAULT_CREDENTIAL).toBeUndefined();
    expect(env.PGPASSWD).toBeUndefined();
  });

  it("policy 'core' keeps only the safe base allowlist (+ explicit adds)", () => {
    const env = resolveChildEnv({ parent, policy: "core" });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/u");
    // Non-core, non-secret vars are NOT inherited under 'core'.
    expect(env.PUBLIC_BASE_URL).toBeUndefined();
    expect(env.API_KEY).toBeUndefined();
  });
});

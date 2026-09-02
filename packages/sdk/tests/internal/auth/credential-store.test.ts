import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  authFilePath,
  CredentialError,
  readAuthFile,
  readStoredOAuth,
  writeCredential,
} from "../../../src/internal/auth/credential-store.js";
import type { CredentialStoreConfig } from "../../../src/internal/auth/types.js";

/**
 * M42 — ported from agent-builder `agents/lib/credentials.test.ts`. REAL tmp-dir fs (no fs mocks) so the
 * 0600 / atomic-write / symlink / mode-gate invariants are tested against a real filesystem, as in the
 * source suite. Generalized to `provider: string` + a `CredentialStoreConfig`.
 */

const roots: string[] = [];

function newStore(): { config: CredentialStoreConfig; dir: string } {
  const home = mkdtempSync(join(tmpdir(), "cred-store-"));
  roots.push(home);
  const config: CredentialStoreConfig = { home, dirName: ".theo-auth", fileName: "auth.json" };
  return { config, dir: join(home, ".theo-auth") };
}

/** Writes a real auth.json with the given contents + modes, returning the config. */
function homeWith(contents: string, fileMode = 0o600, dirMode = 0o700): CredentialStoreConfig {
  const { config, dir } = newStore();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "auth.json");
  writeFileSync(path, contents);
  chmodSync(path, fileMode);
  chmodSync(dir, dirMode);
  return config;
}

afterEach(() => {
  for (const r of roots.splice(0)) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("credential-store — atomic 0600 write", () => {
  it("creates the file at mode exactly 0600", () => {
    const { config } = newStore();
    const path = writeCredential({ provider: "openai", apiKey: "sk-live-abc" }, config);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("leaves no .tmp-* file after a successful write", () => {
    const { config, dir } = newStore();
    writeCredential({ provider: "openai", apiKey: "sk-live-abc" }, config);
    const leftovers = readdirSync(dir).filter((f: string) => f.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });

  it("a failed write (empty key) leaves the previous file intact", () => {
    const { config } = newStore();
    writeCredential({ provider: "openai", apiKey: "sk-first" }, config);
    expect(() => writeCredential({ provider: "openai", apiKey: "" }, config)).toThrow(
      CredentialError,
    );
    const resolved = readAuthFile(config);
    expect(resolved).toBeDefined();
    expect((resolved as { api_key: string }).api_key).toBe("sk-first");
  });

  it("round-trips an api credential as {provider, api_key} with no type key", () => {
    const { config } = newStore();
    const path = writeCredential({ provider: "openrouter", apiKey: "sk-or-xyz" }, config);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(raw).toEqual({ provider: "openrouter", api_key: "sk-or-xyz" });
  });
});

describe("credential-store — mode gates", () => {
  it("rejects a world-writable dir with a chmod 700 hint", () => {
    const config = homeWith('{"provider":"openai","api_key":"sk-x"}', 0o600, 0o777);
    expect(() => readAuthFile(config)).toThrow(/writable by other users/);
    expect(() => readAuthFile(config)).toThrow(/chmod 700/);
  });

  it("rejects a group-writable dir", () => {
    const config = homeWith('{"provider":"openai","api_key":"sk-x"}', 0o600, 0o770);
    expect(() => readAuthFile(config)).toThrow(CredentialError);
  });

  it("rejects a group-readable file with a chmod hint", () => {
    const config = homeWith('{"provider":"openai","api_key":"sk-x"}', 0o644, 0o700);
    expect(() => readAuthFile(config)).toThrow(/chmod/);
  });

  it("accepts a 0600 file in a 0700 dir", () => {
    const config = homeWith('{"provider":"openai","api_key":"sk-x"}', 0o600, 0o700);
    const stored = readAuthFile(config);
    expect((stored as { api_key: string }).api_key).toBe("sk-x");
  });
});

describe("credential-store — oauth union + back-compat", () => {
  it("round-trips an oauth credential at 0600 with expiry", () => {
    const { config } = newStore();
    const path = writeCredential(
      {
        type: "oauth",
        provider: "openai",
        access: "acc-1",
        refresh: "ref-1",
        expires: 1_700_000_000_000,
        account_id: "acct-x",
      },
      config,
    );
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const stored = readStoredOAuth(config);
    expect(stored).toBeDefined();
    expect(stored?.access).toBe("acc-1");
    expect(stored?.refresh).toBe("ref-1");
    expect(stored?.expires).toBe(1_700_000_000_000);
    expect(stored?.account_id).toBe("acct-x");
  });

  it("reads a legacy {provider, api_key} (no type) as an api credential — no migration", () => {
    const config = homeWith('{"provider":"anthropic","api_key":"sk-ant-legacy"}');
    const stored = readAuthFile(config);
    expect(stored?.type).toBeUndefined();
    expect((stored as { api_key: string }).api_key).toBe("sk-ant-legacy");
    expect(readStoredOAuth(config)).toBeUndefined();
  });

  it("refuses to write an oauth credential with an empty refresh token", () => {
    const { config } = newStore();
    expect(() =>
      writeCredential(
        { type: "oauth", provider: "openai", access: "a", refresh: "", expires: 1 },
        config,
      ),
    ).toThrow(CredentialError);
  });

  it("rejects a malformed oauth store (missing refresh) naming the file", () => {
    const config = homeWith('{"type":"oauth","provider":"openai","access":"a","expires":1}');
    expect(() => readAuthFile(config)).toThrow(/auth\.json/);
  });
});

describe("credential-store — malformed input", () => {
  it("rejects non-JSON with a typed error naming the file", () => {
    const config = homeWith("not json at all");
    expect(() => readAuthFile(config)).toThrow(/not valid JSON/);
  });

  it("returns undefined when the store is absent", () => {
    const { config } = newStore();
    expect(readAuthFile(config)).toBeUndefined();
  });

  it("honors a homeEnvVar override for the store dir", () => {
    const { config } = newStore();
    const override = mkdtempSync(join(tmpdir(), "cred-override-"));
    roots.push(override);
    const cfg = { ...config, homeEnvVar: "THEO_AUTH_HOME" };
    const env = { THEO_AUTH_HOME: override };
    expect(authFilePath(cfg, env)).toBe(join(override, "auth.json"));
    writeCredential({ provider: "openai", apiKey: "sk-ovr" }, cfg, env);
    expect((readAuthFile(cfg, env) as { api_key: string }).api_key).toBe("sk-ovr");
  });
});

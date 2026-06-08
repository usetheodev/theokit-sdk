/**
 * T5.6 — Forbidden-path blocklist expansion + case-insensitive
 * (DR6 finding #6).
 *
 * Pre-T5.6 `isForbiddenPath` covered only `.env`, `.git/`,
 * `node_modules/`, `.theo/`, and lock files. It missed every
 * developer-machine credential dot-dir / dot-file that a coding
 * agent must NOT touch — `.ssh/`, `.aws/`, `.docker/`, `.kube/`,
 * `.npmrc`, `.netrc`, `.pgpass`, `id_rsa`, `id_ed25519`,
 * `authorized_keys`, `known_hosts`, and the entire `*.pem` /
 * `*.key` private-material family.
 *
 * Comparisons were also case-sensitive — `.ENV` or `.Git` slipped
 * through on Windows-defaulting checkouts where the FS is
 * case-insensitive but the lexical compare is not. T5.6 normalizes
 * each path segment to lowercase before matching.
 */

import { describe, expect, it } from "vitest";
import { isForbiddenPath } from "../../../src/internal/security/index.js";

describe("T5.6 — top-level credential dot-dirs/dot-files blocked", () => {
  it("blocks .ssh/ at top level", () => {
    expect(isForbiddenPath(".ssh/id_rsa")).toBe(true);
  });

  it("blocks .aws/credentials", () => {
    expect(isForbiddenPath(".aws/credentials")).toBe(true);
  });

  it("blocks .docker/config.json", () => {
    expect(isForbiddenPath(".docker/config.json")).toBe(true);
  });

  it("blocks .kube/config", () => {
    expect(isForbiddenPath(".kube/config")).toBe(true);
  });

  it("blocks .npmrc at top level", () => {
    expect(isForbiddenPath(".npmrc")).toBe(true);
  });

  it("blocks .netrc at top level", () => {
    expect(isForbiddenPath(".netrc")).toBe(true);
  });

  it("blocks .pgpass at top level", () => {
    expect(isForbiddenPath(".pgpass")).toBe(true);
  });
});

describe("T5.6 — credential file basenames blocked at any depth", () => {
  it("blocks id_rsa at any depth", () => {
    expect(isForbiddenPath("subdir/keys/id_rsa")).toBe(true);
  });

  it("blocks id_ed25519 at any depth", () => {
    expect(isForbiddenPath("config/id_ed25519")).toBe(true);
  });

  it("blocks authorized_keys at any depth", () => {
    expect(isForbiddenPath("nested/dir/authorized_keys")).toBe(true);
  });

  it("blocks known_hosts at any depth", () => {
    expect(isForbiddenPath("ssh/known_hosts")).toBe(true);
  });
});

describe("T5.6 — *.pem / *.key suffix family blocked", () => {
  it("blocks *.pem at any depth", () => {
    expect(isForbiddenPath("certs/server.pem")).toBe(true);
  });

  it("blocks *.key at any depth", () => {
    expect(isForbiddenPath("certs/server.key")).toBe(true);
  });

  it("blocks *.pem at top level", () => {
    expect(isForbiddenPath("private.pem")).toBe(true);
  });
});

describe("T5.6 — case-insensitive matching defeats bypass", () => {
  it("blocks .ENV (uppercase)", () => {
    expect(isForbiddenPath(".ENV")).toBe(true);
  });

  it("blocks .Git/ (mixed case)", () => {
    expect(isForbiddenPath(".Git/HEAD")).toBe(true);
  });

  it("blocks .SSH/id_rsa", () => {
    expect(isForbiddenPath(".SSH/id_rsa")).toBe(true);
  });

  it("blocks AUTHORIZED_KEYS", () => {
    expect(isForbiddenPath("nested/AUTHORIZED_KEYS")).toBe(true);
  });

  it("blocks server.PEM (uppercase suffix)", () => {
    expect(isForbiddenPath("certs/server.PEM")).toBe(true);
  });

  it("blocks PNPM-LOCK.YAML", () => {
    expect(isForbiddenPath("PNPM-LOCK.YAML")).toBe(true);
  });
});

describe("T5.6 — regression: pre-existing patterns continue to work", () => {
  it("still blocks .env", () => {
    expect(isForbiddenPath(".env")).toBe(true);
  });

  it("still blocks .env.local", () => {
    expect(isForbiddenPath(".env.local")).toBe(true);
  });

  it("still allowlists .env.example", () => {
    expect(isForbiddenPath(".env.example")).toBe(false);
  });

  it("still blocks .git/HEAD", () => {
    expect(isForbiddenPath(".git/HEAD")).toBe(true);
  });

  it("still blocks node_modules/foo", () => {
    expect(isForbiddenPath("node_modules/foo")).toBe(true);
  });

  it("still blocks pnpm-lock.yaml at any depth", () => {
    expect(isForbiddenPath("apps/web/pnpm-lock.yaml")).toBe(true);
  });

  it("still allows safe paths", () => {
    expect(isForbiddenPath("src/index.ts")).toBe(false);
  });

  it("still allows package.json", () => {
    expect(isForbiddenPath("package.json")).toBe(false);
  });
});

/**
 * `checkCredentialsFile` tests (T3.1 — Phase 3).
 *
 * Covers EC-1 (wrong-type OAuth), EC-2 (malformed JSON), path traversal,
 * happy path, missing file.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkCredentialsFile } from "../../src/setup/gworkspace.js";

let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "tk-creds-check-"));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const DESKTOP_OAUTH_FIXTURE = {
  installed: {
    client_id: "111-abc.apps.googleusercontent.com",
    client_secret: "GOCSPX-xxx",
    redirect_uris: ["http://localhost"],
  },
};

const WEB_OAUTH_FIXTURE = {
  web: {
    client_id: "222-xyz.apps.googleusercontent.com",
    client_secret: "GOCSPX-yyy",
    redirect_uris: ["https://example.com/oauth"],
  },
};

describe("checkCredentialsFile", () => {
  it("test_returns_ok_for_valid_desktop_oauth", () => {
    const path = join(scratch, "credentials.json");
    writeFileSync(path, JSON.stringify(DESKTOP_OAUTH_FIXTURE), "utf8");
    const outcome = checkCredentialsFile(path);
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") expect(outcome.path).toBe(path);
  });

  it("test_returns_missing_when_file_absent", () => {
    const path = join(scratch, "nonexistent.json");
    const outcome = checkCredentialsFile(path);
    expect(outcome.kind).toBe("missing");
  });

  it("test_returns_malformed_for_invalid_json (EC-2)", () => {
    const path = join(scratch, "malformed.json");
    writeFileSync(path, "{not valid json", "utf8");
    const outcome = checkCredentialsFile(path);
    expect(outcome.kind).toBe("malformed");
    if (outcome.kind === "malformed") {
      expect(outcome.reason.length).toBeGreaterThan(0);
    }
  });

  it("test_returns_wrong_type_for_web_oauth_client (EC-1 MUST FIX)", () => {
    const path = join(scratch, "web-credentials.json");
    writeFileSync(path, JSON.stringify(WEB_OAUTH_FIXTURE), "utf8");
    const outcome = checkCredentialsFile(path);
    expect(outcome.kind).toBe("wrong_type");
  });

  it("test_returns_malformed_for_missing_installed_block", () => {
    const path = join(scratch, "no-installed.json");
    writeFileSync(path, JSON.stringify({ other: "stuff" }), "utf8");
    const outcome = checkCredentialsFile(path);
    expect(outcome.kind).toBe("malformed");
    if (outcome.kind === "malformed") {
      expect(outcome.reason.toLowerCase()).toContain("installed");
    }
  });

  it("test_returns_malformed_for_non_object_json", () => {
    const path = join(scratch, "array.json");
    writeFileSync(path, JSON.stringify(["array", "not", "object"]), "utf8");
    const outcome = checkCredentialsFile(path);
    expect(outcome.kind).toBe("malformed");
  });

  it("test_rejects_path_with_parent_traversal_segments", () => {
    const traversalPath = "../../etc/passwd";
    const outcome = checkCredentialsFile(traversalPath);
    expect(outcome.kind).toBe("rejected_path");
  });
});

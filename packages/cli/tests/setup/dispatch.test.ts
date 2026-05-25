/**
 * `theokit setup` dispatch tests (T3.1 — Phase 3).
 *
 * Verifies commander wires the `setup` verb, dispatches `gworkspace`,
 * rejects unknown domains, and surfaces EC-1/EC-2 outcomes as exit 2.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../../src/index.js";

let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "tk-setup-dispatch-"));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("theokit setup (dispatch)", () => {
  it("test_setup_unknown_domain_exits_2", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await main(["node", "theokit", "setup", "notion"]);
    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/unknown setup domain/);
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("test_setup_gworkspace_non_interactive_missing_creds_exits_2", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const missing = join(scratch, "no-creds-here.json");
    const code = await main([
      "node",
      "theokit",
      "setup",
      "gworkspace",
      "--credentials-path",
      missing,
      "--non-interactive",
    ]);
    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/credentials\.json not found/i);
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("test_setup_gworkspace_web_oauth_client_rejected_with_actionable_message (EC-1)", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const credsPath = join(scratch, "web-creds.json");
    writeFileSync(
      credsPath,
      JSON.stringify({ web: { client_id: "x", redirect_uris: ["https://example.com"] } }),
      "utf8",
    );
    const code = await main([
      "node",
      "theokit",
      "setup",
      "gworkspace",
      "--credentials-path",
      credsPath,
      "--non-interactive",
    ]);
    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toContain("Web application");
    expect(stderr).toContain("Desktop application");
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("test_setup_gworkspace_malformed_credentials_exits_2_with_parse_error (EC-2)", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const credsPath = join(scratch, "garbage.json");
    writeFileSync(credsPath, "{not valid json", "utf8");
    const code = await main([
      "node",
      "theokit",
      "setup",
      "gworkspace",
      "--credentials-path",
      credsPath,
      "--non-interactive",
    ]);
    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stderr).toMatch(/could not be parsed/i);
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("test_setup_gworkspace_non_interactive_valid_creds_exits_0", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const credsPath = join(scratch, "good-creds.json");
    writeFileSync(
      credsPath,
      JSON.stringify({
        installed: {
          client_id: "111-abc.apps.googleusercontent.com",
          client_secret: "GOCSPX-xxx",
          redirect_uris: ["http://localhost"],
        },
      }),
      "utf8",
    );
    const code = await main([
      "node",
      "theokit",
      "setup",
      "gworkspace",
      "--credentials-path",
      credsPath,
      "--non-interactive",
    ]);
    expect(code).toBe(0);
    const stdout = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(stdout).toContain("credentials validated");
    expect(stdout).toContain("non-interactive");
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("test_top_level_help_lists_setup_verb", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const code = await main(["node", "theokit", "--help"]);
    expect(code).toBe(0);
    const joined = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(joined).toContain("setup");
    stdoutSpy.mockRestore();
  });
});

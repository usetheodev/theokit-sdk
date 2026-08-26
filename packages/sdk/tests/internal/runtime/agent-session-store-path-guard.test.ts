/**
 * SE40 (v4.0) — path safety for the native transcript path. `transcriptPath` composes
 * `<baseDir>/projects/<encodeProjectDir(cwd)>/<sessionUuidFor(id)>.jsonl`.
 *
 * #400 replaced the old `safeSessionId` filename (sanitize each hostile character to `-`) with a
 * UUID, so the CLI can resume the session. That makes the safety property STRONGER rather than
 * merely different: a derived name is hex and dashes by construction, so there is no hostile input
 * left to sanitize — `..`, `/` and every other character stop being representable in the filename at
 * all, instead of being mapped to something harmless.
 *
 * These tests therefore assert the PROPERTY (nothing escapes the perimeter, the basename is a UUID)
 * and no longer the exact sanitized string, which was an artifact of how the property used to be
 * achieved.
 */

import { describe, expect, it } from "vitest";

import {
  safeSessionId,
  sessionUuidFor,
  transcriptPath,
} from "../../../src/internal/persistence/session-transcript.js";

const UUID_BASENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

const basename = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

describe("transcriptPath — path safety (SE40)", () => {
  it("neutralizes '..' traversal in the agent id", () => {
    const p = transcriptPath("/base", "/tmp/cwd", "../etc/passwd");
    expect(p).not.toContain("..");
    expect(p).toContain("/base/projects/");
    expect(basename(p)).toMatch(UUID_BASENAME);
  });

  it("neutralizes slashes in the agent id", () => {
    const p = transcriptPath("/base", "/tmp/cwd", "foo/bar");
    expect(basename(p)).toMatch(UUID_BASENAME);
    expect(basename(p)).not.toContain("foo");
  });

  it("gives a hostile id and a benign one names of the same harmless shape", () => {
    expect(basename(transcriptPath("/base", "/tmp/cwd", "../../etc/shadow"))).toMatch(
      UUID_BASENAME,
    );
    expect(basename(transcriptPath("/base", "/tmp/cwd", "billing-bot"))).toMatch(UUID_BASENAME);
  });

  // These two ids used to be asserted "unchanged", which is precisely the defect #400 reported:
  // measured against CLI 2.1.236, `agent-<uuid>.jsonl` is NOT offered by `claude --continue` — only
  // a bare UUID basename is. The old expectation encoded the bug as the contract.
  it("does not leave the local agent-<uuid> id as the filename, which the cli cannot resume", () => {
    const id = "agent-02897280-f155-4044-bbd6-0cc5ef8bf194";
    const p = transcriptPath("/base", "/tmp/cwd", id);
    expect(p).not.toContain(`${id}.jsonl`);
    expect(basename(p)).toMatch(UUID_BASENAME);
  });

  it("does not leave the cloud bc-<uuid> id as the filename, which the cli cannot resume", () => {
    const id = "bc-14ebe9e6-a4c1-412c-8cd4-fa17c32831fa";
    const p = transcriptPath("/base", "/tmp/cwd", id);
    expect(p).not.toContain(`${id}.jsonl`);
    expect(basename(p)).toMatch(UUID_BASENAME);
  });

  it("leaves an id that is already a bare uuid alone, so a cli-written session keeps its name", () => {
    const id = "02897280-f155-4044-bbd6-0cc5ef8bf194";
    expect(basename(transcriptPath("/base", "/tmp/cwd", id))).toBe(`${id}.jsonl`);
  });

  it("encodes the cwd into a single path component", () => {
    const p = transcriptPath("/base", "/home/u/project x", "a1");
    // encodeProjectDir replaces every non-alphanumeric with '-'.
    expect(p).toContain("/base/projects/-home-u-project-x/");
  });
});

// `safeSessionId` no longer names the transcript, but it still guards the LEGACY path an existing
// session keeps using (`legacyTranscriptPath`), so its sanitizing contract is still load-bearing.
describe("safeSessionId — still the guard for legacy transcript names", () => {
  it("replaces a slash so a hostile id cannot leave the directory", () => {
    expect(safeSessionId("foo/bar")).toBe("foo-bar");
  });

  it("replaces every character of a '..' segment", () => {
    expect(safeSessionId("../evil")).toBe("---evil");
  });

  it("leaves an already-safe id untouched", () => {
    expect(safeSessionId("agent-02897280-f155-4044-bbd6-0cc5ef8bf194")).toBe(
      "agent-02897280-f155-4044-bbd6-0cc5ef8bf194",
    );
  });
});

describe("sessionUuidFor — determinism", () => {
  it("derives the same name for the same id every time", () => {
    expect(sessionUuidFor("billing-bot")).toBe(sessionUuidFor("billing-bot"));
  });
});

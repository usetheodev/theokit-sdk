/**
 * SE40 (v4.0) — path safety for the native transcript path. `transcriptPath`
 * composes `<baseDir>/projects/<encodeProjectDir(cwd)>/<safeSessionId(id)>.jsonl`;
 * `safeSessionId` REPLACES any non `[A-Za-z0-9_-]` character with `-` so a hostile
 * agent id can never traverse out of the sanitized perimeter (no throw — sanitize).
 */

import { describe, expect, it } from "vitest";

import {
  safeSessionId,
  transcriptPath,
} from "../../../src/internal/persistence/session-transcript.js";

describe("transcriptPath / safeSessionId — path safety (SE40)", () => {
  it("neutralizes '..' traversal in the agent id", () => {
    const p = transcriptPath("/base", "/tmp/cwd", "../etc/passwd");
    expect(p).not.toContain("..");
    expect(p).toContain("/base/projects/");
    expect(p.endsWith(".jsonl")).toBe(true);
  });

  it("neutralizes slashes in the agent id", () => {
    expect(safeSessionId("foo/bar")).toBe("foo-bar");
    const p = transcriptPath("/base", "/tmp/cwd", "foo/bar");
    expect(p).toContain("foo-bar.jsonl");
  });

  it("accepts local agent-<uuid> format unchanged", () => {
    const id = "agent-02897280-f155-4044-bbd6-0cc5ef8bf194";
    expect(safeSessionId(id)).toBe(id);
    expect(transcriptPath("/base", "/tmp/cwd", id)).toContain(`${id}.jsonl`);
  });

  it("accepts cloud bc-<uuid> format unchanged", () => {
    const id = "bc-14ebe9e6-a4c1-412c-8cd4-fa17c32831fa";
    expect(safeSessionId(id)).toBe(id);
    expect(transcriptPath("/base", "/tmp/cwd", id)).toContain(`${id}.jsonl`);
  });

  it("encodes the cwd into a single path component", () => {
    const p = transcriptPath("/base", "/home/u/project x", "a1");
    // encodeProjectDir replaces every non-alphanumeric with '-'.
    expect(p).toContain("/base/projects/-home-u-project-x/");
  });
});

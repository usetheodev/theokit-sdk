import { describe, expect, it } from "vitest";
import { gitDiff, gitLog, gitStatus } from "../../src/infra/git.js";

// These tests run against the real repo root — they are integration tests.
// They use the current working directory which is a git repo.
const CWD = process.cwd();

describe("git", () => {
  it("gitStatus returns ok:true with file list in a git repo", async () => {
    const result = await gitStatus(CWD);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Array.isArray(result.files)).toBe(true);
    }
  });

  it("gitStatus returns ok:false for non-existent directory", async () => {
    const result = await gitStatus("/nonexistent-dir-abc123");
    expect(result.ok).toBe(false);
  });

  it("gitDiff returns ok:true in a git repo", async () => {
    const result = await gitDiff(CWD);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.diff).toBe("string");
    }
  });

  it("gitLog returns ok:true with commits", async () => {
    const result = await gitLog(CWD, 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commits.length).toBeGreaterThan(0);
      expect(result.commits.length).toBeLessThanOrEqual(3);
      expect(result.commits[0]).toHaveProperty("hash");
      expect(result.commits[0]).toHaveProperty("message");
      expect(result.commits[0]).toHaveProperty("date");
    }
  });

  it("gitLog returns ok:false for non-existent directory", async () => {
    const result = await gitLog("/nonexistent-dir-abc123");
    expect(result.ok).toBe(false);
  });
});

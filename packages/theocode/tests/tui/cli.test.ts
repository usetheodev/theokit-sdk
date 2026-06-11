import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../src/tui/cli.js";

describe("parseCliArgs", () => {
  it("parses all supported flags", () => {
    const opts = parseCliArgs([
      "--model",
      "anthropic/claude-sonnet-4",
      "--session",
      "abc123",
      "--project-root",
      "/tmp/project",
    ]);
    expect(opts.model).toBe("anthropic/claude-sonnet-4");
    expect(opts.session).toBe("abc123");
    expect(opts.projectRoot).toBe("/tmp/project");
  });

  it("returns empty options for no arguments", () => {
    const opts = parseCliArgs([]);
    expect(opts.model).toBeUndefined();
    expect(opts.session).toBeUndefined();
    expect(opts.projectRoot).toBeUndefined();
  });
});

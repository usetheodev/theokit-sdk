import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TOOL_GUIDANCE,
  injectGuidance,
  withDefaultGuidance,
  withToolResultGuidance,
} from "../src/internal/tool-guidance.js";
import { createReadFileTool } from "../src/read-file.js";

const MAP = { not_found: "use list_dir to find the path" };

describe("injectGuidance — additive on ok:false", () => {
  it("adds guidance for a known error code", () => {
    const parsed = JSON.parse(injectGuidance('{"ok":false,"error":"not_found"}', MAP));
    expect(parsed.guidance).toBe("use list_dir to find the path");
  });

  it("preserves the other fields of the payload", () => {
    const parsed = JSON.parse(injectGuidance('{"ok":false,"error":"not_found","path":"/x"}', MAP));
    expect(parsed.path).toBe("/x");
    expect(parsed.guidance).toBe("use list_dir to find the path");
  });
});

describe("injectGuidance — passthrough (never-throw)", () => {
  it("leaves an ok:true result unchanged", () => {
    const input = '{"ok":true,"content":"x"}';
    expect(injectGuidance(input, MAP)).toBe(input);
  });

  it("returns unchanged for an unknown error code", () => {
    const input = '{"ok":false,"error":"weird"}';
    expect(injectGuidance(input, MAP)).toBe(input);
  });

  it("passes through non-JSON output verbatim (no throw)", () => {
    expect(() => injectGuidance("not json at all", MAP)).not.toThrow();
    expect(injectGuidance("not json at all", MAP)).toBe("not json at all");
  });

  it("passes through valid-but-non-object JSON (array/null/number) (EC-1)", () => {
    expect(injectGuidance("[1,2]", MAP)).toBe("[1,2]");
    expect(injectGuidance("null", MAP)).toBe("null");
    expect(injectGuidance("5", MAP)).toBe("5");
  });

  it("preserves an existing guidance field (idempotent)", () => {
    const input = '{"ok":false,"error":"not_found","guidance":"mine"}';
    expect(injectGuidance(input, MAP)).toBe(input);
  });
});

describe("DEFAULT_TOOL_GUIDANCE", () => {
  it("covers the common cross-tool error codes", () => {
    for (const code of [
      "not_found",
      "no_match",
      "timeout",
      "ssrf_blocked",
      "catastrophic_command",
    ]) {
      expect(typeof DEFAULT_TOOL_GUIDANCE[code]).toBe("string");
    }
  });
});

describe("withToolResultGuidance / withDefaultGuidance", () => {
  it("preserves the wrapped tool's name/description/inputSchema", () => {
    const base = createReadFileTool({ projectRoot: "/tmp" });
    const wrapped = withToolResultGuidance(base, MAP);
    expect(wrapped.name).toBe(base.name);
    expect(wrapped.description).toBe(base.description);
    expect(wrapped.inputSchema).toEqual(base.inputSchema);
  });

  describe("integration against a real built-in tool", () => {
    let projectRoot: string;
    beforeEach(() => {
      projectRoot = mkdtempSync(join(tmpdir(), "sdk-guidance-"));
    });
    afterEach(() => {
      rmSync(projectRoot, { recursive: true, force: true });
    });

    it("injects guidance on a real failing read_file (not_found)", async () => {
      const tool = withDefaultGuidance(createReadFileTool({ projectRoot }));
      const parsed = JSON.parse(await tool.handler({ path: "nope.txt" }));
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toBe("not_found");
      expect(typeof parsed.guidance).toBe("string");
    });

    it("passes a successful read_file through without guidance", async () => {
      writeFileSync(join(projectRoot, "hi.txt"), "hello");
      const tool = withDefaultGuidance(createReadFileTool({ projectRoot }));
      const parsed = JSON.parse(await tool.handler({ path: "hi.txt" }));
      expect(parsed.ok).toBe(true);
      expect(parsed.guidance).toBeUndefined();
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  formatCode,
  formatDiff,
  formatError,
  formatFileList,
  formatTruncated,
} from "../src/formatter.js";

describe("formatCode", () => {
  it("wraps code in fenced block with language", () => {
    const result = formatCode("typescript", "const x = 1;");
    expect(result).toBe("```typescript\nconst x = 1;\n```");
  });
});

describe("formatDiff", () => {
  it("wraps diff in fenced diff block", () => {
    const result = formatDiff("+added\n-removed");
    expect(result).toBe("```diff\n+added\n-removed\n```");
  });
});

describe("formatFileList", () => {
  it("formats files as bulleted list", () => {
    const result = formatFileList(["a.ts", "b.ts"]);
    expect(result).toBe("- a.ts\n- b.ts");
  });

  it("returns placeholder for empty list", () => {
    expect(formatFileList([])).toBe("(no files)");
  });
});

describe("formatError", () => {
  it("formats error without code", () => {
    const result = formatError("something failed");
    expect(result).toBe("> **Error:** something failed");
  });

  it("formats error with code", () => {
    const result = formatError("not found", "E404");
    expect(result).toBe("> **Error:** [E404] not found");
  });
});

describe("formatTruncated", () => {
  it("formats truncated reference", () => {
    const result = formatTruncated("/tmp/overflow.txt");
    expect(result).toBe("...full output at: /tmp/overflow.txt");
  });
});

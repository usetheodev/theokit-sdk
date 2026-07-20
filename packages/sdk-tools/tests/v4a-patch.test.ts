import { describe, expect, it } from "vitest";

import {
  applyUpdateChunks,
  parseV4A,
  seekSequence,
  type V4AHunk,
  V4APatchError,
} from "../src/internal/v4a-patch.js";

const wrap = (body: string) => `*** Begin Patch\n${body}\n*** End Patch`;

describe("parseV4A — envelope + hunk kinds", () => {
  it("parses Add File (strips one +, always trailing newline)", () => {
    const h = parseV4A(wrap("*** Add File: src/a.ts\n+export const x = 1;\n+const y = 2;"));
    expect(h).toEqual<V4AHunk[]>([
      { kind: "add", path: "src/a.ts", content: "export const x = 1;\nconst y = 2;\n" },
    ]);
  });

  it("parses Delete File", () => {
    expect(parseV4A(wrap("*** Delete File: old.ts"))).toEqual([{ kind: "delete", path: "old.ts" }]);
  });

  it("parses Update File with a @@ context, -/+/space lines", () => {
    const h = parseV4A(
      wrap("*** Update File: a.ts\n@@ function main\n context\n-old line\n+new line\n more"),
    );
    expect(h).toEqual<V4AHunk[]>([
      {
        kind: "update",
        path: "a.ts",
        movePath: null,
        chunks: [
          {
            context: "function main",
            oldLines: ["context", "old line", "more"],
            newLines: ["context", "new line", "more"],
            eof: false,
          },
        ],
      },
    ]);
  });

  it("parses Update File with Move to + End of File", () => {
    const h = parseV4A(
      wrap("*** Update File: a.ts\n*** Move to: b.ts\n@@\n-x\n+y\n*** End of File"),
    );
    const u = h[0] as Extract<V4AHunk, { kind: "update" }>;
    expect(u.movePath).toBe("b.ts");
    expect(u.chunks[0]!.eof).toBe(true);
  });

  it("parses multiple change chunks in one Update File", () => {
    const h = parseV4A(wrap("*** Update File: a.ts\n@@\n-a\n+A\n@@\n-b\n+B"));
    const u = h[0] as Extract<V4AHunk, { kind: "update" }>;
    expect(u.chunks).toHaveLength(2);
  });

  it("throws on missing Begin/End and on a stray line", () => {
    expect(() => parseV4A("no envelope")).toThrow(V4APatchError);
    expect(() =>
      parseV4A("*** Begin Patch\n*** Update File: a.ts\n@@\nzzz\n*** End Patch"),
    ).toThrow(/must start with/);
  });
});

describe("seekSequence — the matching ladder", () => {
  const lines = "alpha\n  beta  \ngamma".split("\n");
  it("exact match", () => {
    expect(seekSequence(lines, ["alpha"], 0, false)).toBe(0);
  });
  it("tolerates trailing/leading whitespace (rstrip/trim)", () => {
    expect(seekSequence(lines, ["beta"], 0, false)).toBe(1);
  });
  it("returns null when absent", () => {
    expect(seekSequence(lines, ["zzz"], 0, false)).toBeNull();
  });
  it("eof anchors to the tail", () => {
    expect(seekSequence(["x", "y", "x"], ["x"], 0, true)).toBe(2);
  });
});

describe("applyUpdateChunks — apply to content", () => {
  it("applies a single -/+ change anchored by context", () => {
    const content = "line1\nfunction main\nold\nline4\n";
    const chunks = parseV4A(wrap("*** Update File: a.ts\n@@ function main\n-old\n+new")) as never;
    const u = (chunks as V4AHunk[])[0] as Extract<V4AHunk, { kind: "update" }>;
    expect(applyUpdateChunks(content, "a.ts", u.chunks)).toBe("line1\nfunction main\nnew\nline4\n");
  });

  it("matches a unicode-dash line via the fuzzy pass", () => {
    const content = "const dash = —;\n"; // em-dash in file
    const h = parseV4A(
      wrap("*** Update File: a.ts\n@@\n-const dash = -;\n+const dash = 1;"),
    ) as V4AHunk[];
    const u = h[0] as Extract<V4AHunk, { kind: "update" }>;
    expect(applyUpdateChunks(content, "a.ts", u.chunks)).toBe("const dash = 1;\n");
  });

  it("throws a typed error on a context miss (no partial state — pure)", () => {
    const h = parseV4A(wrap("*** Update File: a.ts\n@@ nope\n-x\n+y")) as V4AHunk[];
    const u = h[0] as Extract<V4AHunk, { kind: "update" }>;
    expect(() => applyUpdateChunks("a\nb\n", "a.ts", u.chunks)).toThrow(
      /Failed to find context 'nope'/,
    );
  });

  it("applies two chunks forward-only", () => {
    const content = "a\nb\nc\nd\n";
    const h = parseV4A(wrap("*** Update File: f\n@@\n-a\n+A\n@@\n-c\n+C")) as V4AHunk[];
    const u = h[0] as Extract<V4AHunk, { kind: "update" }>;
    expect(applyUpdateChunks(content, "f", u.chunks)).toBe("A\nb\nC\nd\n");
  });
});

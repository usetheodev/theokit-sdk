import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonlParseError, loadJsonl } from "../../src/internal/persistence/jsonl.js";

describe("loadJsonl (M6-5)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "theo-jsonl-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, content: string): string => {
    const p = join(dir, name);
    writeFileSync(p, content);
    return p;
  };

  it("parses objects and skips blank lines", () => {
    const p = write("a.jsonl", '{"a":1}\n\n{"a":2}\n');
    expect(loadJsonl(p)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("throws a line-numbered JsonlParseError on invalid JSON", () => {
    const p = write("bad.jsonl", '{"a":1}\n{not json\n');
    let err: unknown;
    try {
      loadJsonl(p);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(JsonlParseError);
    expect((err as JsonlParseError).line).toBe(2);
    expect((err as JsonlParseError).message).toContain("line 2");
  });

  it("throws 'not a JSON object' for a non-object line", () => {
    const p = write("num.jsonl", "42\n");
    expect(() => loadJsonl(p)).toThrow(/line 1: not a JSON object/);
  });

  it("applies map for typed rows with the 1-based line number", () => {
    const p = write("m.jsonl", '{"id":"x"}\n{"id":"y"}\n');
    const rows = loadJsonl<{ id: string; ln: number }>(p, {
      map: (raw, lineNumber) => ({ id: String(raw.id), ln: lineNumber }),
    });
    expect(rows).toEqual([
      { id: "x", ln: 1 },
      { id: "y", ln: 2 },
    ]);
  });

  it("returns an empty array for an empty file", () => {
    const p = write("empty.jsonl", "");
    expect(loadJsonl(p)).toEqual([]);
  });
});

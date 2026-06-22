import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendJsonl,
  JsonlParseError,
  loadJsonl,
  readJsonlIds,
} from "../../src/internal/persistence/jsonl.js";

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

describe("appendJsonl (M6-1)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "theo-append-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends one line per record and creates the parent dir", () => {
    const p = join(dir, "nested", "deep", "out.jsonl");
    appendJsonl(p, { id: "x" });
    appendJsonl(p, { id: "y" });
    const lines = readFileSync(p, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "")).toEqual({ id: "x" });
    expect(JSON.parse(lines[1] ?? "")).toEqual({ id: "y" });
  });
});

describe("readJsonlIds (M6-1)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "theo-ids-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, content: string): string => {
    const p = join(dir, name);
    writeFileSync(p, content);
    return p;
  };

  it("returns only keys for which the predicate yields a non-empty string", () => {
    const p = write(
      "ids.jsonl",
      '{"id":"a","ok":true}\n{"id":"b","ok":false}\n{"id":"c","ok":true}\n',
    );
    const ids = readJsonlIds(p, (r) => (r.ok === true ? String(r.id) : undefined));
    expect([...ids].sort()).toEqual(["a", "c"]);
  });

  it("tolerates a trailing partial line from an interrupted run", () => {
    const p = write("partial.jsonl", '{"id":"a"}\n{"id":"b"}\n{"id":"c"');
    const ids = readJsonlIds(p, (r) => String(r.id));
    expect([...ids].sort()).toEqual(["a", "b"]);
  });

  it("returns an empty set for a missing file", () => {
    expect(readJsonlIds(join(dir, "nope.jsonl"), (r) => String(r.id)).size).toBe(0);
  });
});

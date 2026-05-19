/**
 * Lint test (T5.2, ADR D111) — bans global mutable tool whitelist in `src/`.
 *
 * Per-fork tool whitelists MUST be propagated via `AsyncLocalStorage` so
 * parallel forks (background review, curator, judge) don't corrupt each
 * other's state. A global `let _toolWhitelist: Set<string>` would let
 * fork A read fork B's set, defeating the whole point.
 *
 * Detected patterns (heuristic — false positives must justify with a
 * comment or refactor):
 * - `let toolWhitelist`
 * - `let _toolWhitelist`
 * - `let whitelist:`
 *
 * The canonical store lives in `internal/runtime/async-local-storage.ts`
 * (the `toolWhitelistStore` constant of type `AsyncLocalStorage`).
 *
 * @internal
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(__dirname, "..", "..", "src");

interface Offender {
  file: string;
  line: number;
  text: string;
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(dir);
  for (const name of entries) {
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) await walk(full, out);
    else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

const PATTERN = /\blet\s+(_?[Tt]ool[Ww]hitelist|_?whitelist\s*:)/;

describe("no global mutable tool whitelist (T5.2, ADR D111)", () => {
  it("packages/sdk/src/ has no `let _toolWhitelist` / `let whitelist:` declarations", async () => {
    const files = await walk(SRC_ROOT);
    const offenders: Offender[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line !== undefined && PATTERN.test(line)) {
          offenders.push({
            file: relative(SRC_ROOT, file),
            line: i + 1,
            text: line.trim(),
          });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("async-local-storage.ts exports the canonical AsyncLocalStorage<Set<string>>", async () => {
    const text = await readFile(
      join(SRC_ROOT, "internal", "runtime", "async-local-storage.ts"),
      "utf8",
    );
    expect(text).toContain("AsyncLocalStorage<Set<string>>");
    expect(text).toContain("export async function withToolWhitelist");
    expect(text).toContain("export function checkToolWhitelist");
  });
});

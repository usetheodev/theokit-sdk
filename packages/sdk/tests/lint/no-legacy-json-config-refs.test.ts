/**
 * Lint gate (T5.2, EC-11 fix from edge-case review). Fails CI when
 * `docs.md` shows ACTIVE references to legacy `context.json`
 * (excluding deprecation-context lines that explicitly mention
 * migration / removal).
 *
 * NOTE: `hooks.json` is NO LONGER legacy — ADR 0016 reverted file-based
 * hooks to JSON in the Claude Code shape, so `.theokit/hooks.json` is the
 * canonical hooks config again. Only `context.json` (context stays
 * markdown) remains legacy and is enforced here.
 *
 * Same pattern as `no-hardcoded-theokit-path.test.ts`.
 *
 * @internal
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_MD = join(__dirname, "..", "..", "..", "..", "docs.md");

/** Lines that mention context.json in deprecation/migration
 *  context are intentionally allowed. */
const ALLOWED_KEYWORDS = [
  "deprecated",
  "deprecation",
  "removed in v2.0",
  "migrate via",
  "legacy",
  "theokit-migrate-config",
  // From security-redaction section (line 1731), reference to redact module:
  ".theokit/policy.js",
];

describe("lint: docs.md must not reference legacy context.json actively", () => {
  it("no active references", () => {
    const raw = readFileSync(DOCS_MD, "utf8");
    const lines = raw.split("\n");
    const offenders: { line: number; text: string }[] = [];
    for (const [idx, line] of lines.entries()) {
      // `context.json` is legacy (context stays markdown); `hooks.json` is canonical
      // again per ADR 0016, so it is intentionally NOT flagged here.
      if (!/context\.json/i.test(line)) continue;
      const lower = line.toLowerCase();
      if (ALLOWED_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()))) continue;
      offenders.push({ line: idx + 1, text: line.trim().slice(0, 120) });
    }
    if (offenders.length > 0) {
      process.stderr.write(
        `\nLegacy JSON config refs in docs.md (active, not in deprecation context):\n` +
          offenders.map((o) => `  - docs.md:${o.line}  ${o.text}`).join("\n") +
          `\n\nRewrite to point at .theokit/<dir>/<name>.md or add a deprecation keyword to the line.\n`,
      );
    }
    expect(offenders).toEqual([]);
  });
});

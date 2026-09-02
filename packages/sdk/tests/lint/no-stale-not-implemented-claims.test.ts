/**
 * A "not implemented yet" note must carry an expiry, or it outlives the work it describes.
 *
 * Measured 2026-09-01: SIX places in `src/` said a pluggable extension point was "wired to the type
 * surface only" and gave the consumer "NOT runtime enforcement". All six were false. `budgetTracker`
 * is read at `internal/agent-loop/loop.ts:78-81`, advanced at `:110` and charged at `:390`/`:397`;
 * `memoryProvider` runs `init` / `buildTools` / `runActivePass` / `sync` / `dispose` across
 * `loop-context-init.ts` and `loop.ts`. Two of the six were on `@public` symbols and therefore
 * shipped in the published `.d.ts`.
 *
 * The damage runs in the expensive direction. Nothing breaks: a consumer reads that the SDK will not
 * enforce their cost ceiling, and rationally builds a second control outside it — or stops passing
 * the option. A stale "not yet" is believed precisely because it is specific, and nothing in this
 * repository compared such a claim against the call graph.
 *
 * So the rule is not "never write one". It is that a claim about the future carries the two things
 * that let someone check it later: WHERE the work is tracked, and WHEN the claim should have been
 * revisited. Same shape as `code-quality-allowlist.txt`'s mandatory sunset, and the same reason.
 */
import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/** Phrases that assert a capability does not exist yet. */
const STALE_CLAIM =
  /type surface only|NOT runtime enforcement|not wired yet|wiring lands in|lands in a subsequent iteration|lands in subsequent iteration|not implemented yet/i;

/**
 * A tracking reference AND a date, which together make the claim checkable later.
 *
 * The reference alphabet is this repository's own: GitHub issues (`#151`), ADRs (`ADR 0015`), and
 * the plan vocabularies that actually appear in these comments — `EC-7`, `T3.7`, `M45`, `B-099`,
 * `D438`, `SE36`, `G8`. Matching only `#NNN` would have rejected a comment that names its follow-up
 * perfectly well; matching anything numeric would accept a version string. Both halves are required,
 * so a loose reference pattern does not make the gate toothless — the date is the half that expires.
 */
const HAS_ISSUE = /#\d+|\b(?:ADR|EC|SE|T|M|B|D|G)[- ]?\d+/;
const HAS_SUNSET = /\d{4}-\d{2}-\d{2}/;

/**
 * Opt-out for a line that must contain the phrase — a verbatim quotation of a claim being
 * corrected, or a detector naming what it detects. Mirrors the `english-only:` convention: the
 * reason after the colon is mandatory, because a silent opt-out is the thing being prevented.
 */
const EXEMPT = /stale-claim-ok:\s*\S/;

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Whether a line is either not a stale claim at all, or one whose comment block accounts for it.
 *
 * The reference, the date and the exemption may all sit anywhere in the same comment block rather
 * than on the offending line — an exemption for a long user-facing string has to go on the line
 * above it, because putting it inside would change what the user reads. Hence the window rather than
 * a per-line test.
 */
function isAccountedFor(lines: readonly string[], line: string, index: number): boolean {
  if (!STALE_CLAIM.test(line)) return true;
  const window = lines.slice(Math.max(0, index - 8), index + 9).join("\n");
  if (EXEMPT.test(window)) return true;
  return HAS_ISSUE.test(window) && HAS_SUNSET.test(window);
}

describe("a not-implemented claim carries an issue reference and a sunset date", () => {
  it("every stale-claim phrase in src/ is checkable or exempted", async () => {
    const files = await walk("src");

    // ANTI-VACUITY GUARD. There are zero offenders today, so every assertion below passes over an
    // empty list — which is exactly how a check quietly stops checking. A file COUNT would drift
    // into a ratchet nobody re-derives; a named file that must be in the scan cannot.
    expect(files, "the scan of src/ must reach the file this rule was written for").toContain(
      "src/types/agent.ts",
    );
    expect(files.length, "src/ cannot plausibly hold fewer than 100 .ts files").toBeGreaterThan(
      100,
    );

    const offenders: string[] = [];
    for (const file of files) {
      const lines = (await readFile(file, "utf8")).split("\n");
      lines.forEach((line, i) => {
        if (isAccountedFor(lines, line, i)) return;
        offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }

    expect(
      offenders,
      "A 'not implemented yet' note with no issue reference and no date cannot be re-checked, so " +
        "it survives the work it describes — six of them did, two on @public symbols that ship in " +
        "the .d.ts. Add both, or mark the line `stale-claim-ok: <reason>` if it must quote one.",
    ).toEqual([]);
  });
});

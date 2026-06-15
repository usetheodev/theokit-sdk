/**
 * applyPersonalityFilter — additive narrowing of exposed tools by an
 * active personality preset's `tools` whitelist (T4.1, ADRs D102+D167).
 *
 * Contract:
 *
 * - `whitelist === undefined` → return `exposedTools` unchanged (no
 *   active personality OR personality has no tool restriction).
 * - `whitelist === []` → return empty array (explicit "no tools for
 *   this persona").
 * - Otherwise → return the subset of `exposedTools` whose `name` is
 *   present in `whitelist`. Missing entries emit a one-shot stderr
 *   warning per `(agentId, personalityName, missingTool)` combo
 *   (advisory only — D167 says missing tools must NOT crash).
 *
 * **EC-I:** MCP-style names like `mcp__server__tool` are matched as
 * exact strings (no regex semantics) — the registry already produces
 * the verbatim name.
 *
 * **EC-15:** Duplicate entries in `whitelist` are deduped silently.
 *
 * **EC-17:** Missing names within Levenshtein distance ≤2 of an exposed
 * tool emit a "did you mean: X" hint inside the warning.
 *
 * The function is **pure**: it never mutates the input array.
 *
 * @internal
 */

import { warnOnce } from "../runtime/hooks/hooks-source.js";

export interface ToolNamed {
  readonly name: string;
}

export interface ApplyPersonalityFilterOptions {
  /** Used in the dedup key + warning prefix so logs are traceable. */
  agentId?: string;
  /** Active personality slug — used in the dedup key + warning. */
  personalityName?: string;
}

/**
 * Filter `exposedTools` to the personality `whitelist`. Pure.
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: undefined → unchanged, empty → empty, then filter + per-missing warning with Levenshtein hint — each branch is one short line of intent.
export function applyPersonalityFilter<T extends ToolNamed>(
  exposedTools: ReadonlyArray<T>,
  whitelist: ReadonlyArray<string> | undefined,
  opts?: ApplyPersonalityFilterOptions,
): ReadonlyArray<T> {
  if (whitelist === undefined) return exposedTools;
  if (whitelist.length === 0) return [];

  const wanted = new Set(whitelist); // EC-15: dedup
  const exposedSet = new Set(exposedTools.map((t) => t.name));
  const kept = exposedTools.filter((t) => wanted.has(t.name));

  // EC-17: warn once per missing tool (with did-you-mean hint when close).
  for (const name of wanted) {
    if (exposedSet.has(name)) continue;
    const hint = suggestClosest(name, exposedSet);
    const message =
      hint !== undefined
        ? `[theokit-sdk] personality "${opts?.personalityName ?? "?"}" references unknown tool "${name}"; did you mean "${hint}"?`
        : `[theokit-sdk] personality "${opts?.personalityName ?? "?"}" references unknown tool "${name}" (not exposed)`;
    warnOnce(
      `personality-tool-missing|${opts?.agentId ?? "?"}|${opts?.personalityName ?? "?"}|${name}`,
      message,
    );
  }

  return kept;
}

/**
 * Return the name in `pool` with Levenshtein distance ≤2 to `target`,
 * or undefined if none is close enough.
 *
 * Keeps cognitive complexity low: short-circuits on equal length, runs
 * the standard DP only when both names are non-trivial.
 *
 * @internal
 */
function suggestClosest(target: string, pool: ReadonlySet<string>): string | undefined {
  let best: { name: string; dist: number } | undefined;
  for (const candidate of pool) {
    if (Math.abs(candidate.length - target.length) > 2) continue;
    const d = levenshtein(target, candidate);
    if (d > 2) continue;
    if (best === undefined || d < best.dist) best = { name: candidate, dist: d };
  }
  return best?.name;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev: number[] = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(
        prev[j]! + 1,
        prev[j - 1]! + 1,
        prevDiag + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1),
      );
      prevDiag = tmp;
    }
  }
  return prev[b.length]!;
}

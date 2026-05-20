/**
 * Lint gate: prevent regression in path-traversal defense (T4.1, ADR D85).
 *
 * Scans `src/internal/**` for the bad pattern:
 *   `join(<anything containing ".theokit">, ..., varName)`
 * where `varName` is a non-literal identifier as the final segment.
 *
 * Allowlisted files are those that either:
 *   - Use `safePathJoin` directly (path-guard.ts is the API).
 *   - Build internal-only paths from literals (no user-shaped variable).
 *   - Sanitize identifiers via `sanitizeIdentifier` before joining.
 *
 * Mirror of `tests/lint/no-unredacted-sink.test.ts` (T1.5.2 secret-redaction).
 */

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC_ROOT = join(__dirname, "..", "..", "src");

/**
 * Files that legitimately join `.theokit` with a non-literal variable but
 * have been audited to either (a) use `safePathJoin`, (b) sanitize first,
 * or (c) operate exclusively on filesystem-controlled identifiers (fs.readdir).
 */
const ALLOWLIST = new Set<string>([
  // Uses safePathJoin
  "internal/runtime/plugins-manager.ts",
  "internal/runtime/agent-session-store.ts",
  "internal/runtime/skills-manager.ts",
  "internal/memory/types.ts",
  "internal/mcp/client.ts",
  // Filesystem-controlled (readdir loops, no user input joined)
  "internal/runtime/subagents-loader.ts",
  "internal/runtime/context-manager.ts",
  "internal/runtime/hooks-source.ts",
  "internal/memory/dreaming/diary.ts",
  "internal/memory/dreaming/run.ts",
  "internal/memory/index-db.ts",
  "internal/memory/index-manager.ts",
  "internal/memory/lance-index.ts",
  "internal/memory/markdown-store.ts",
  "internal/memory/migrate-sqlite-to-lance.ts",
  "internal/memory/session-loader.ts",
  "internal/memory/session-summary-writer.ts",
  "internal/memory/transcript-store.ts",
  "internal/memory/reader.ts",
  // Literal-only joins (the `.theokit` segment is followed by static strings)
  "internal/mcp/token-storage.ts",
  "internal/persistence/paths.ts",
  "internal/persistence/markdown-config-loader.ts",
  "internal/runtime/agent-registry-store.ts",
  "internal/runtime/mcp-tools.ts",
  "internal/runtime/local-agent.ts",
]);

/**
 * Match `join(...".theokit"..., variableName)` where the final argument
 * is a non-string identifier (no quote, no dot, no template literal).
 */
const BAD_PATTERN = /\bjoin\s*\([^)]*["']\.theokit["'][^)]*,\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/;

interface Offender {
  file: string;
  line: number;
  excerpt: string;
  variable: string;
}

async function walkTs(dir: string, out: string[] = []): Promise<string[]> {
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) {
      await walkTs(full, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function scanFile(file: string, content: string): Offender[] {
  // If file uses safePathJoin OR sanitizeIdentifier, it's already guarded.
  if (content.includes("safePathJoin") || content.includes("sanitizeIdentifier")) {
    return [];
  }
  const out: Offender[] = [];
  for (const [idx, raw] of content.split("\n").entries()) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      continue;
    }
    const match = BAD_PATTERN.exec(raw);
    if (match !== null) {
      const variable = match[1] ?? "<unknown>";
      out.push({ file, line: idx + 1, excerpt: trimmed, variable });
    }
  }
  return out;
}

describe("lint: no unguarded path input in src/ (T4.1, ADR D85)", () => {
  it("allowlist entries all exist on disk", () => {
    for (const rel of ALLOWLIST) {
      const abs = join(SRC_ROOT, rel);
      expect(
        existsSync(abs),
        `allowlist entry stale: ${rel} (refactor moved or removed the file?)`,
      ).toBe(true);
    }
  });

  it("BAD_PATTERN catches variable final segment (EC-6 positive case)", () => {
    const sample = 'const p = join(cwd, ".theokit", "agents", agentId);';
    const m = BAD_PATTERN.exec(sample);
    expect(m).not.toBeNull();
    expect(m?.[1]).toBe("agentId");
  });

  it("BAD_PATTERN does NOT flag literal-only joins (EC-6 negative case)", () => {
    const sample = 'const p = join(cwd, ".theokit", "agents", "registry.json");';
    expect(BAD_PATTERN.exec(sample)).toBeNull();
  });

  it("scans src/ for unguarded path joins (gate)", async () => {
    const files = await walkTs(SRC_ROOT);
    const offenders: Offender[] = [];
    for (const file of files) {
      const rel = relative(SRC_ROOT, file).replace(/\\/g, "/");
      if (ALLOWLIST.has(rel)) continue;
      const content = await readFile(file, "utf8");
      const fileOffenders = scanFile(rel, content);
      offenders.push(...fileOffenders);
    }
    if (offenders.length > 0) {
      const summary = offenders
        .map(
          (o) =>
            `  ${o.file}:${o.line} — join(..., ${o.variable}) — wrap with safePathJoin or add ${o.file} to ALLOWLIST with rationale`,
        )
        .join("\n");
      process.stderr.write(`Unguarded path joins found:\n${summary}\n`);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Drift gate for the scaffolded Claude Code template (`packages/sdk/claude-template/`).
 *
 * `npx theokit-init-claude` copies this template into a user's project. It MUST
 * teach the current public API, not the pre-3.0 surface removed by SE36. This
 * gate fails CI when the template teaches a removed factory, a phantom subpath,
 * or a non-existent stream event — the exact drift that shipped in #139.
 *
 * The patterns match POSITIVE usage only (imports + calls), so anti-pattern
 * prose ("NEVER use `defineTool` — use `Tool.create`") does not false-positive.
 *
 * @internal
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const templateDir = join(__dirname, "..", "..", "claude-template");

/** Every `.md` file in the template. */
function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.name.endsWith(".md") && statSync(full).isFile()) out.push(full);
  }
  return out;
}

// Removed at v3.0 (SE36) — the uniform `X.create()` API replaced these.
const REMOVED_FACTORIES = [
  "defineTool",
  "defineProvider",
  "definePlugin",
  "defineSubAgent",
  "defineSubscription",
  "defineAuth",
  "defineSkillReadTool",
  "createAgentFactory",
  "createSquad",
  "createSkill",
  "createSessionManager",
  "createSemaphore",
  "createPermissionPlugin",
  "createTokenLimiter",
  "createUnicodeNormalizer",
];

// Import subpaths that are NOT in `@theokit/sdk`'s exports map.
const PHANTOM_SUBPATHS = ["rag", "tools"]; // built-in tools live in @theokit/sdk-tools

describe("claude-template must teach the current @theokit/sdk API (no #139 drift)", () => {
  const files = markdownFiles(templateDir);

  it("scans at least the known template files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("never imports or calls a removed factory", () => {
    const offenders: string[] = [];
    const importRe = new RegExp(
      String.raw`import\s*\{[^}]*\b(${REMOVED_FACTORIES.join("|")})\b[^}]*\}\s*from\s*["']@theokit/sdk`,
    );
    const callRe = new RegExp(String.raw`\b(${REMOVED_FACTORIES.join("|")})\s*\(`);
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (importRe.test(line) || callRe.test(line)) {
            offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 100)}`);
          }
        });
    }
    if (offenders.length) {
      process.stderr.write(
        `\nRemoved factory used in the scaffold (use X.create instead):\n${offenders.join("\n")}\n`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("never imports from a phantom subpath", () => {
    const offenders: string[] = [];
    const re = new RegExp(String.raw`from\s*["']@theokit/sdk/(${PHANTOM_SUBPATHS.join("|")})["']`);
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (re.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 100)}`);
        });
    }
    if (offenders.length) {
      process.stderr.write(
        `\nImport from a non-existent @theokit/sdk subpath:\n${offenders.join("\n")}\n`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it("never teaches a non-existent stream event as a type discriminant", () => {
    // Real SDKMessage types: system/user/assistant/thinking/tool_call/status/task/request.
    const offenders: string[] = [];
    const re = /type\s*[:=]=?\s*["'](tool_use|tool_result|usage|error)["']/;
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (re.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 100)}`);
        });
    }
    if (offenders.length) {
      process.stderr.write(
        `\nNon-existent stream event type in the scaffold (use tool_call/assistant/thinking/status):\n${offenders.join("\n")}\n`,
      );
    }
    expect(offenders).toEqual([]);
  });
});

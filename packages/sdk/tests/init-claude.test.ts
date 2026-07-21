import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT_PATH = join(import.meta.dirname, "../bin/init-claude.mjs");
const TEMPLATE_DIR = join(import.meta.dirname, "../claude-template");

function run(cwd: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [SCRIPT_PATH, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e: unknown) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

// Derived from the template on disk (NOT hardcoded) — the scaffold's skill set
// grows/shrinks over releases (e.g. theokit-rag removed at 4.2.7; +16 skills at
// 4.2.8), and a hardcoded list silently rots. Reading the real dirs makes every
// per-skill assertion below cover exactly what ships.
const SKILLS_BASE = join(TEMPLATE_DIR, "dot-claude", "skills");
const SKILL_DIRS = readdirSync(SKILLS_BASE, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

describe("init-claude CLI", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "theokit-init-claude-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .claude/ directory", () => {
    const result = run(tmpDir);
    expect(result.status).toBe(0);
    expect(existsSync(join(tmpDir, ".claude"))).toBe(true);
  });

  it("creates AGENTS.md at project root", () => {
    run(tmpDir);
    expect(existsSync(join(tmpDir, "AGENTS.md"))).toBe(true);
  });

  it("creates CLAUDE.md at project root", () => {
    run(tmpDir);
    expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(true);
  });

  it("merges into existing .claude/ without overwriting (adds missing files)", () => {
    mkdirSync(join(tmpDir, ".claude"));
    writeFileSync(join(tmpDir, ".claude", "custom.md"), "user content");
    const result = run(tmpDir);
    expect(result.status).toBe(0);
    // User's file preserved
    expect(readFileSync(join(tmpDir, ".claude", "custom.md"), "utf8")).toBe("user content");
    // TheoKit files added
    expect(existsSync(join(tmpDir, ".claude", "rules", "theokit-conventions.md"))).toBe(true);
    expect(result.stdout).toContain("Added");
  });

  it("preserves existing AGENTS.md and adds .claude/ skills (EC-4 merge)", () => {
    writeFileSync(join(tmpDir, "AGENTS.md"), "user agents content");
    const result = run(tmpDir);
    expect(result.status).toBe(0);
    // User's AGENTS.md preserved
    expect(readFileSync(join(tmpDir, "AGENTS.md"), "utf8")).toBe("user agents content");
    // Skills still added
    expect(existsSync(join(tmpDir, ".claude", "skills", "theokit-agent-core", "SKILL.md"))).toBe(
      true,
    );
    expect(result.stdout).toContain("Skipped");
  });

  it("skips existing skill files without overwriting", () => {
    mkdirSync(join(tmpDir, ".claude", "skills", "theokit-agent-core"), { recursive: true });
    writeFileSync(join(tmpDir, ".claude", "skills", "theokit-agent-core", "SKILL.md"), "custom");
    const result = run(tmpDir);
    expect(result.status).toBe(0);
    // User's custom skill preserved
    expect(
      readFileSync(join(tmpDir, ".claude", "skills", "theokit-agent-core", "SKILL.md"), "utf8"),
    ).toBe("custom");
  });

  it("--force overwrites all files including existing ones", () => {
    writeFileSync(join(tmpDir, "AGENTS.md"), "old content");
    const result = run(tmpDir, ["--force"]);
    expect(result.status).toBe(0);
    // AGENTS.md overwritten with template content
    const content = readFileSync(join(tmpDir, "AGENTS.md"), "utf8");
    expect(content).toContain("@theokit/sdk");
    expect(content).not.toBe("old content");
  });

  it("copies every template skill directory", () => {
    run(tmpDir);
    const skillsDir = join(tmpDir, ".claude", "skills");
    expect(existsSync(skillsDir)).toBe(true);
    const dirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(dirs.length).toBe(SKILL_DIRS.length);
    for (const name of SKILL_DIRS) {
      expect(dirs).toContain(name);
    }
  });

  it("copies rules/theokit-conventions.md", () => {
    run(tmpDir);
    expect(existsSync(join(tmpDir, ".claude", "rules", "theokit-conventions.md"))).toBe(true);
  });

  it("copies settings.json", () => {
    run(tmpDir);
    expect(existsSync(join(tmpDir, ".claude", "settings.json"))).toBe(true);
  });
});

describe("AGENTS.md template", () => {
  const agentsPath = join(TEMPLATE_DIR, "AGENTS.md");

  it("exists", () => {
    expect(existsSync(agentsPath)).toBe(true);
  });

  it("stays concise (<= 170 lines)", () => {
    // Ceiling bumped from 150 when the #139 rewrite grew AGENTS.md to teach the
    // full X.create() surface + anti-patterns (deliberate, correct content).
    // Still a bloat guard — the doc must not balloon past a scannable page.
    const lines = readFileSync(agentsPath, "utf8").split("\n").length;
    expect(lines).toBeLessThanOrEqual(170);
  });

  it("has import map with @theokit/sdk", () => {
    const content = readFileSync(agentsPath, "utf8");
    expect(content).toContain("@theokit/sdk");
  });

  it("has Agent.create reference", () => {
    const content = readFileSync(agentsPath, "utf8");
    expect(content).toContain("Agent.create");
  });

  it("has Tool reference", () => {
    const content = readFileSync(agentsPath, "utf8");
    expect(content).toContain("Tool");
  });

  it("does not use internal paths in import examples", () => {
    const content = readFileSync(agentsPath, "utf8");
    // Anti-pattern warnings mentioning "internal" are OK — actual import statements are not
    const importLines = content.split("\n").filter((l) => l.startsWith("import "));
    for (const line of importLines) {
      expect(line).not.toContain("@theokit/sdk/internal");
    }
  });

  it("import map matches package.json exports (EC-2)", () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
    const exportKeys = Object.keys(pkg.exports || {})
      .filter((k) => k !== "." && !k.includes("*"))
      .map((k) => k.replace("./", ""));
    const content = readFileSync(agentsPath, "utf8");
    // Allow some sub-paths to be omitted if they are internal/niche
    // but the major ones must be present
    const majorPaths = ["errors", "rag", "subscription"];
    for (const p of majorPaths) {
      if (exportKeys.includes(p)) {
        expect(content).toContain(`@theokit/sdk/${p}`);
      }
    }
  });
});

describe("CLAUDE.md template", () => {
  const claudePath = join(TEMPLATE_DIR, "CLAUDE.md");

  it("exists", () => {
    expect(existsSync(claudePath)).toBe(true);
  });

  it("imports AGENTS.md", () => {
    const content = readFileSync(claudePath, "utf8");
    expect(content).toContain("@AGENTS.md");
  });

  it("lists every skill directory", () => {
    const content = readFileSync(claudePath, "utf8");
    for (const name of SKILL_DIRS) {
      expect(content).toContain(name);
    }
  });
});

describe("Convention rules", () => {
  const rulesPath = join(TEMPLATE_DIR, "dot-claude", "rules", "theokit-conventions.md");

  it("exists", () => {
    expect(existsSync(rulesPath)).toBe(true);
  });

  it("is under 40 lines", () => {
    const lines = readFileSync(rulesPath, "utf8").split("\n").length;
    expect(lines).toBeLessThanOrEqual(40);
  });

  it("has import guidance", () => {
    const content = readFileSync(rulesPath, "utf8");
    expect(content).toContain("@theokit/sdk");
  });

  it("bans internal imports", () => {
    const content = readFileSync(rulesPath, "utf8");
    expect(content.toLowerCase()).toContain("never");
    expect(content).toContain("internal");
  });
});

describe("settings.json template", () => {
  const settingsPath = join(TEMPLATE_DIR, "dot-claude", "settings.json");

  it("exists", () => {
    expect(existsSync(settingsPath)).toBe(true);
  });

  it("is valid JSON", () => {
    const content = readFileSync(settingsPath, "utf8");
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it("denies .env file reads", () => {
    const content = readFileSync(settingsPath, "utf8");
    expect(content).toContain(".env");
  });
});

describe("All skills", () => {
  const skillsBase = SKILLS_BASE;

  it("every skill directory has a SKILL.md", () => {
    for (const name of SKILL_DIRS) {
      const skillPath = join(skillsBase, name, "SKILL.md");
      expect(existsSync(skillPath), `Missing: ${name}/SKILL.md`).toBe(true);
    }
  });

  it("all skills have user-invocable: false in frontmatter", () => {
    for (const name of SKILL_DIRS) {
      const content = readFileSync(join(skillsBase, name, "SKILL.md"), "utf8");
      expect(content, `${name} missing user-invocable: false`).toContain("user-invocable: false");
    }
  });

  it("all skills have paths: in frontmatter", () => {
    for (const name of SKILL_DIRS) {
      const content = readFileSync(join(skillsBase, name, "SKILL.md"), "utf8");
      expect(content, `${name} missing paths:`).toContain("paths:");
    }
  });

  it("no skill uses **/*.ts as sole path (EC-3)", () => {
    for (const name of SKILL_DIRS) {
      const content = readFileSync(join(skillsBase, name, "SKILL.md"), "utf8");
      // Extract the frontmatter paths section
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch?.[1]) {
        const fm = fmMatch[1];
        const pathLines = fm.split("\n").filter((l) => l.trim().startsWith('- "**/*.ts"'));
        const allPaths = fm.split("\n").filter((l) => l.trim().startsWith('- "'));
        if (allPaths.length === 1 && pathLines.length === 1) {
          expect.fail(`${name} uses only **/*.ts — EC-3 violation`);
        }
      }
    }
  });

  it("no skill exceeds 300 lines", () => {
    for (const name of SKILL_DIRS) {
      const content = readFileSync(join(skillsBase, name, "SKILL.md"), "utf8");
      const lines = content.split("\n").length;
      expect(lines, `${name} has ${lines} lines`).toBeLessThanOrEqual(300);
    }
  });

  it("no skill references a NON-exported internal SDK path", () => {
    // `@theokit/sdk/internal/persistence` + `/internal/security` ARE real,
    // publicly-exported subpaths (semver-exempt, for extracted packages), so a
    // skill may document them. Any OTHER `@theokit/sdk/internal/...` is banned.
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8"));
    const allowed = new Set(
      Object.keys(pkg.exports ?? {})
        .filter((k) => k.startsWith("./internal/"))
        .map((k) => `@theokit/sdk${k.slice(1)}`),
    );
    for (const name of SKILL_DIRS) {
      const content = readFileSync(join(skillsBase, name, "SKILL.md"), "utf8");
      const refs = content.match(/@theokit\/sdk\/internal\/[a-z-]+/g) ?? [];
      for (const ref of refs) {
        expect(allowed.has(ref), `${name} references non-exported internal path ${ref}`).toBe(true);
      }
    }
  });

  it("no skill has trailing whitespace in YAML values (EC-6)", () => {
    for (const name of SKILL_DIRS) {
      const content = readFileSync(join(skillsBase, name, "SKILL.md"), "utf8");
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch?.[1]) {
        const lines = fmMatch[1].split("\n");
        for (const line of lines) {
          expect(line, `${name} has trailing whitespace: "${line}"`).not.toMatch(/\S\s+$/);
        }
      }
    }
  });
});

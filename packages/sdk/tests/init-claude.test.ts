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

const SKILL_DIRS = [
  "theokit-agent-core",
  "theokit-tools",
  "theokit-memory",
  "theokit-di",
  "theokit-di-agent",
  "theokit-gateways",
  "theokit-rag",
  "theokit-workflows",
  "theokit-eval",
  "theokit-cron",
  "theokit-subscriptions",
  "theokit-errors",
  "theokit-config",
  "theokit-streaming",
  "theokit-budget",
];

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

  it("refuses overwrite without --force (EC-4: checks .claude/ + AGENTS.md + CLAUDE.md)", () => {
    mkdirSync(join(tmpDir, ".claude"));
    const result = run(tmpDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--force");
  });

  it("refuses when only AGENTS.md exists (EC-4)", () => {
    writeFileSync(join(tmpDir, "AGENTS.md"), "existing");
    const result = run(tmpDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("AGENTS.md");
  });

  it("force overwrites with --force", () => {
    mkdirSync(join(tmpDir, ".claude"));
    const result = run(tmpDir, ["--force"]);
    expect(result.status).toBe(0);
    expect(existsSync(join(tmpDir, ".claude", "rules"))).toBe(true);
  });

  it("copies 15 skill directories", () => {
    run(tmpDir);
    const skillsDir = join(tmpDir, ".claude", "skills");
    expect(existsSync(skillsDir)).toBe(true);
    const dirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(dirs.length).toBe(15);
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

  it("is under 150 lines", () => {
    const lines = readFileSync(agentsPath, "utf8").split("\n").length;
    expect(lines).toBeLessThanOrEqual(150);
  });

  it("has import map with @theokit/sdk", () => {
    const content = readFileSync(agentsPath, "utf8");
    expect(content).toContain("@theokit/sdk");
  });

  it("has Agent.create reference", () => {
    const content = readFileSync(agentsPath, "utf8");
    expect(content).toContain("Agent.create");
  });

  it("has defineTool reference", () => {
    const content = readFileSync(agentsPath, "utf8");
    expect(content).toContain("defineTool");
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

  it("lists all 15 skill directories", () => {
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

describe("All 15 skills", () => {
  const skillsBase = join(TEMPLATE_DIR, "dot-claude", "skills");

  it("all 15 skill directories exist with SKILL.md", () => {
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

  it("no skill references internal SDK paths", () => {
    for (const name of SKILL_DIRS) {
      const content = readFileSync(join(skillsBase, name, "SKILL.md"), "utf8");
      expect(content, `${name} references internal path`).not.toContain("@theokit/sdk/internal");
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

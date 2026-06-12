#!/usr/bin/env node
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

// EC-1: Node version guard (matches SDK engines.node)
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`@theokit/sdk requires Node >= 22.12.0. Current: ${process.version}`);
  process.exit(1);
}

const templateDir = join(import.meta.dirname, "../claude-template");
const cwd = process.cwd();
const targetDir = join(cwd, ".claude");
const force = process.argv.includes("--force");

// EC-4: Check .claude/, AGENTS.md, CLAUDE.md independently
const conflicts = [];
if (existsSync(targetDir)) conflicts.push(".claude/");
if (existsSync(join(cwd, "AGENTS.md"))) conflicts.push("AGENTS.md");
if (existsSync(join(cwd, "CLAUDE.md"))) conflicts.push("CLAUDE.md");

if (conflicts.length > 0 && !force) {
  console.error(`Already exists: ${conflicts.join(", ")}. Use --force to overwrite.`);
  process.exit(1);
}

cpSync(join(templateDir, "dot-claude"), targetDir, { recursive: true });
cpSync(join(templateDir, "AGENTS.md"), join(cwd, "AGENTS.md"));
cpSync(join(templateDir, "CLAUDE.md"), join(cwd, "CLAUDE.md"));

console.log("Created .claude/ with TheoKit SDK configuration (15 domain skills).");
console.log("Created AGENTS.md (cross-agent) and CLAUDE.md (Claude Code).");
console.log("\nNext: open Claude Code and start building with TheoKit.");

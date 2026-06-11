/**
 * `skill_loader` — tool for listing and loading skill definitions from a directory.
 *
 * Security: rejects symlinks (EC-1) and path traversal attempts.
 *
 * Return shape (always a JSON string):
 *   - list: `{ ok: true, skills: string[] }`
 *   - load: `{ ok: true, name: string, content: string }`
 *   - error: `{ ok: false, error: string }`
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface SkillToolOptions {
  /** Absolute path to the skills directory (e.g. "/path/to/.theocode/skills"). */
  skillsDir: string;
}

export interface SkillTool {
  name: string;
  description: string;
  inputSchema: unknown;
  handler: (input: { action: string; name?: string }) => string;
}

export function createSkillTool(opts: SkillToolOptions): SkillTool {
  const skillsDir = resolve(opts.skillsDir);

  return {
    name: "skill_loader",
    description:
      "List available skills or load a specific skill definition. " +
      "Actions: 'list' (show available skills), 'load' (read a skill by name). " +
      "Returns { ok, skills } or { ok, name, content } or { ok: false, error }.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["list", "load"],
          description: "The action to perform.",
        },
        name: {
          type: "string",
          description: "Skill name (required for 'load' action).",
        },
      },
      required: ["action"],
    },
    handler: (input: { action: string; name?: string }): string => {
      if (input.action === "list") {
        return listSkills(skillsDir);
      }

      if (input.action === "load") {
        if (!input.name) {
          return JSON.stringify({
            ok: false,
            error: "missing_name",
            message: "Skill name is required for 'load' action.",
          });
        }
        return loadSkill(skillsDir, input.name);
      }

      return JSON.stringify({
        ok: false,
        error: "invalid_action",
        message: `Unknown action '${input.action}'. Valid: list, load.`,
      });
    },
  };
}

function listSkills(skillsDir: string): string {
  if (!existsSync(skillsDir)) {
    return JSON.stringify({ ok: true, skills: [] });
  }

  const entries = readdirSync(skillsDir, { withFileTypes: true });
  const skills = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name.replace(/\.md$/, ""));

  return JSON.stringify({ ok: true, skills });
}

function loadSkill(skillsDir: string, name: string): string {
  // Path traversal rejection
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    return JSON.stringify({ ok: false, error: "path_traversal", message: "Invalid skill name." });
  }

  const filePath = join(skillsDir, `${name}.md`);

  // Verify resolved path is within skillsDir
  const resolved = resolve(filePath);
  if (!resolved.startsWith(skillsDir)) {
    return JSON.stringify({ ok: false, error: "path_traversal", message: "Invalid skill name." });
  }

  if (!existsSync(resolved)) {
    return JSON.stringify({ ok: false, error: "not_found", message: `Skill '${name}' not found.` });
  }

  // EC-1: reject symlinks
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink()) {
    return JSON.stringify({
      ok: false,
      error: "symlink_rejected",
      message: "Symlinks are not allowed for skill files.",
    });
  }

  const content = readFileSync(resolved, "utf-8");
  return JSON.stringify({ ok: true, name, content });
}

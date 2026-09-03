import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { bootstrapSubmanagers } from "../../../../src/internal/local-agent/local-agent-bootstrap.js";
import { removeTempDirRobustSync } from "../../../helpers/temp-workspace.js";

/**
 * usetheokit/theokit-sdk#524, the visibility half — the two surfaces where the answer existed and
 * did not reach the caller.
 *
 * > whatever is imported should be reportable […] Silent inheritance is what made this take a
 * > debugging session to notice.
 *
 * A discovered `Skill` carries `source` — the absolute path to its `SKILL.md` — and the projection
 * in `local-agent-bootstrap.ts` mapped it away to `{ name, description }`. The projection itself is
 * right and stays: a skill's BODY must not leak through `list()`, which is what `get()` is for. But
 * dropping the PATH with the body answers a question nobody asked and silences the one this issue
 * is about.
 *
 * `source` is populated for every skill, disk-read or not: `createSkill` already stamps a
 * code-defined one with the synthetic `inline://<name>` marker (see `create-skill.ts`). This suite
 * only proves the DISK case; the inline case is covered by `agent-skills-get.test.ts` (SE21).
 *
 * ## This test drives the BOOTSTRAP, not the manager
 *
 * A first version asked `SkillsManager.list()` and passed immediately — the manager never dropped
 * anything, because `SkillMetadata` IS `Skill`. The loss happens one layer out, in the projection
 * that builds `agent.skills`, and that layer is the one a consumer actually holds. Testing the
 * manager would have reported the defect as fixed while `agent.skills.list()` still answered
 * `{ name, description }`.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) removeTempDirRobustSync(d);
});

function workspaceWithSkill(root: string, name: string): string {
  const ws = mkdtempSync(join(tmpdir(), "skill-source-"));
  dirs.push(ws);
  const dir = join(ws, root, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: does a thing\n---\n\nBody.\n`,
  );
  return ws;
}

describe("a skill listing says which root the skill came from", () => {
  it("keeps the path for a skill read from the native root", async () => {
    const ws = workspaceWithSkill(".theokit", "native-skill");

    const sub = bootstrapSubmanagers({
      options: { skills: {} },
      workspaceCwd: ws,
      settingSourcesIncludeProject: true,
      settingSourcesIncludePlugins: false,
    } as unknown as Parameters<typeof bootstrapSubmanagers>[0]);
    await sub.skillsManager?.initialize();
    const listed = await sub.skills?.list();

    expect(listed?.find((s) => s.name === "native-skill")?.source).toBe(
      join(ws, ".theokit", "skills", "native-skill", "SKILL.md"),
    );
  });

  it("keeps the FOREIGN path, which is the question the issue asks", async () => {
    const ws = workspaceWithSkill(".claude", "foreign-skill");

    const sub = bootstrapSubmanagers({
      options: { skills: {}, local: { compatSources: ["claude-code"] } },
      workspaceCwd: ws,
      settingSourcesIncludeProject: true,
      settingSourcesIncludePlugins: false,
    } as unknown as Parameters<typeof bootstrapSubmanagers>[0]);
    await sub.skillsManager?.initialize();
    const listed = await sub.skills?.list();

    expect(listed?.find((s) => s.name === "foreign-skill")?.source).toContain(".claude");
  });
});

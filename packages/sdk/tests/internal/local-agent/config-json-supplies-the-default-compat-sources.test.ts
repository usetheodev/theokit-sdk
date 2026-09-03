import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { bootstrapSubmanagers } from "../../../src/internal/local-agent/local-agent-bootstrap.js";
import { removeTempDirRobustSync } from "../../helpers/temp-workspace.js";

/**
 * The wiring half of `readCompatConfigFile` (usetheokit/theokit-sdk#524): a project that declares
 * `.theokit/config.json` gets the same admission as one that passed `local.compatSources` in code —
 * without a consumer having to write any code at all.
 *
 * PRECEDENCE, decided here because the issue does not state it: explicit code wins. A consumer
 * passing `local.compatSources` has made a decision at the call site; a file sitting in the
 * repository is the DEFAULT for callers who did not. This mirrors how every other layered config
 * source in this ecosystem resolves (explicit argument over declared default), and it means a test
 * or a one-off script can always override the file without editing or deleting it.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) removeTempDirRobustSync(d);
});

function workspaceWithForeignSkillAndConfigFile(): string {
  const ws = mkdtempSync(join(tmpdir(), "config-json-compat-"));
  dirs.push(ws);
  mkdirSync(join(ws, ".theokit"), { recursive: true });
  writeFileSync(
    join(ws, ".theokit", "config.json"),
    JSON.stringify({ compat: { adapters: ["claude-code"] } }),
  );
  const skillDir = join(ws, ".claude", "skills", "from-file");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    "---\nname: from-file\ndescription: admitted by config.json alone\n---\n\nBody.\n",
  );
  return ws;
}

describe("config.json supplies the default compatSources", () => {
  it("admits a foreign skill with no code-level local.compatSources at all", async () => {
    const ws = workspaceWithForeignSkillAndConfigFile();

    const sub = bootstrapSubmanagers({
      options: { skills: {} },
      workspaceCwd: ws,
      settingSourcesIncludeProject: true,
      settingSourcesIncludePlugins: false,
    } as unknown as Parameters<typeof bootstrapSubmanagers>[0]);
    await sub.skillsManager?.initialize();
    const listed = await sub.skills?.list();

    expect(listed?.map((s) => s.name)).toContain("from-file");
  });

  it("explicit code compatSources overrides the file, not merges with it", async () => {
    const ws = workspaceWithForeignSkillAndConfigFile();

    const sub = bootstrapSubmanagers({
      options: { skills: {}, local: { compatSources: [] } },
      workspaceCwd: ws,
      settingSourcesIncludeProject: true,
      settingSourcesIncludePlugins: false,
    } as unknown as Parameters<typeof bootstrapSubmanagers>[0]);
    await sub.skillsManager?.initialize();
    const listed = await sub.skills?.list();

    expect(listed?.map((s) => s.name)).not.toContain("from-file");
  });
});

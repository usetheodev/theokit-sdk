import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { Agent } from "../../../src/index.js";
import { removeTempDirRobust } from "../../helpers/temp-workspace.js";

/**
 * Behaviour gate for the real file-based hook executor. Verifies that:
 *   - `preRun` hooks actually spawn the configured command.
 *   - Non-zero exit codes block the run with a `ConfigurationError`.
 *   - Hook stdout receives the payload JSON over stdin.
 */

describe("real hook execution", () => {
  let cwd: string | undefined;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-hooks-"));
    const __cwdCleanup1 = cwd;
    onTestFinished(async () => {
      await removeTempDirRobust(__cwdCleanup1);
    });
    await mkdir(join(cwd, ".theokit"), { recursive: true });
  });
  afterEach(async () => {
    cwd = undefined;
  });

  it("runs an allowing preRun hook and lets the run proceed", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const markerPath = join(cwd, "marker.json");
    const hookCmd = `node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{require('fs').writeFileSync('${markerPath.replaceAll("\\", "\\\\")}', d);})"`;
    // Claude-Code-shaped config: UserPromptSubmit → the SDK's `preRun` firing.
    await writeFile(
      join(cwd, ".theokit", "hooks.json"),
      JSON.stringify({
        hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: hookCmd }] }] },
      }),
    );

    const agent = await Agent.create({
      apiKey: "theo_test_hooks",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd, settingSources: ["project"] },
    });
    const run = await agent.send("Trigger hook");
    await run.wait();

    // The marker file should contain JSON with `event: "preRun"` plus the
    // user-supplied message — proving the hook spawned with our payload.
    const { readFile } = await import("node:fs/promises");
    const captured = await readFile(markerPath, "utf8");
    const parsed = JSON.parse(captured) as { event: string; input?: { message?: string } };
    expect(parsed.event).toBe("preRun");
    expect(parsed.input?.message).toBe("Trigger hook");
  });

  it("denies the run when the preRun hook exits non-zero", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await writeFile(
      join(cwd, ".theokit", "hooks.json"),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: "command",
                  command: "node -e \"process.stderr.write('nope'); process.exit(7)\"",
                },
              ],
            },
          ],
        },
      }),
    );

    const agent = await Agent.create({
      apiKey: "theo_test_hooks",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd, settingSources: ["project"] },
    });
    await expect(agent.send("Trigger hook")).rejects.toMatchObject({
      name: "ConfigurationError",
      message: expect.stringMatching(/preRun hook denied/i),
    });
  });
});

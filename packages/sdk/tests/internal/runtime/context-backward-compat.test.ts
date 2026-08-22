/**
 * T6.1 — Backward compatibility regression suite for context loading.
 *
 * Confirms existing `.theokit/context/*.md` (Zod frontmatter) sources
 * keep working unchanged after the Phase 5 multi-format wiring.
 * Also covers the legacy `.theokit/context.json` deprecation path.
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { FileContextManager } from "../../../src/internal/runtime/context/context-manager.js";
import { removeTempDirRobust } from "../../helpers/temp-workspace.js";

describe("Backward compat: .theokit/context/*.md (T6.1)", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "theokit-ctx-compat-"));
    const __tmpCleanup1 = tmp;
    onTestFinished(async () => {
      await removeTempDirRobust(__tmpCleanup1);
    });
    await mkdir(join(tmp, ".git"), { recursive: true });
    await mkdir(join(tmp, ".theokit", "context"), { recursive: true });
  });

  it("enabled: false excludes source", async () => {
    await writeFile(
      join(tmp, ".theokit", "context", "off.md"),
      "---\nname: off\npath: README.md\nenabled: false\n---\nbody",
    );
    await writeFile(join(tmp, "README.md"), "readme content");
    const mgr = new FileContextManager(tmp, { manager: "file" }, true);
    await mgr.initialize();
    const snap = await mgr.snapshot();
    expect(snap.sources.some((s) => s.name === "off")).toBe(false);
  });

  it("enabled defaults true → source included", async () => {
    await writeFile(
      join(tmp, ".theokit", "context", "on.md"),
      "---\nname: on\npath: README.md\n---\nbody",
    );
    await writeFile(join(tmp, "README.md"), "readme content");
    const mgr = new FileContextManager(tmp, { manager: "file" }, true);
    await mgr.initialize();
    const snap = await mgr.snapshot();
    expect(snap.sources.some((s) => s.name === "on")).toBe(true);
  });

  it("examples/telegram-pro pattern works (frontmatter + body)", async () => {
    await writeFile(join(tmp, "BOT.md"), "Bot description with helpful text.");
    await writeFile(
      join(tmp, ".theokit", "context", "bot-readme.md"),
      "---\nname: bot-readme\npath: BOT.md\n---\n# Bot context\nNotes about the bot.",
    );
    const mgr = new FileContextManager(tmp, { manager: "file" }, true);
    await mgr.initialize();
    const snap = await mgr.snapshot();
    expect(snap.sources.some((s) => s.name === "bot-readme")).toBe(true);
  });

  // EC-K: legacy JSON config loads CONTENT, not just warning
  it("EC-K: legacy .theokit/context.json loads content and emits warning", async () => {
    const stderr = vi.spyOn(process.stderr, "write");
    await writeFile(join(tmp, "DATA.md"), "legacy json source data");
    await writeFile(
      join(tmp, ".theokit", "context.json"),
      JSON.stringify({
        sources: [{ name: "legacy", path: "DATA.md" }],
      }),
    );
    const mgr = new FileContextManager(tmp, { manager: "file" }, true);
    await mgr.initialize();
    const snap = await mgr.snapshot();
    // Content actually loads (EC-K — not just a warning).
    // Legacy path tokenizes by whitespace; join sequence verifies
    // each token is present in the budget.
    expect(snap.sources.some((s) => s.name === "legacy")).toBe(true);
    const usedTokens = snap.budget?.usedTokens;
    const tokens = Array.isArray(usedTokens) ? usedTokens.join("|") : "";
    expect(tokens).toContain("legacy");
    expect(tokens).toContain("json");
    expect(tokens).toContain("data");
    // Warning emitted exactly once
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(".theokit/context.json is deprecated"),
    );
    stderr.mockRestore();
  });

  it("both legacy + new spec coexist via aggregator", async () => {
    await writeFile(join(tmp, "README.md"), "readme body");
    await writeFile(
      join(tmp, ".theokit", "context", "legacy-md.md"),
      "---\nname: legacy-md\npath: README.md\n---\nbody",
    );
    await writeFile(join(tmp, "AGENTS.md"), "agents body");
    const mgr = new FileContextManager(tmp, { manager: "file" }, true);
    await mgr.initialize();
    const snap = await mgr.snapshot();
    expect(snap.sources.some((s) => s.name === "legacy-md")).toBe(true);
    expect(snap.sources.some((s) => s.name === "AGENTS.md")).toBe(true);
  });
});

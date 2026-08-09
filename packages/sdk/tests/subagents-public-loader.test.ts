/**
 * M81 T2.1 — the on-disk subagents loader becomes public.
 *
 * ## The asymmetry that caused the duplication
 *
 * `src/skills.ts:19` already exports `discoverSkills` for the sibling domain. Subagents had the same
 * loader — `internal/runtime/skills/subagents-loader.ts` — but **with no public port**. A consumer
 * behind the UNBREAKABLE boundary (`agent-builder` never imports `@theokit/sdk*`) could not
 * reach it, and the only legal way out was to reimplement.
 *
 * That is what happened. `agents/subagents/roles.ts:13-16` documents the result, in writing:
 *
 * > *"`loadRole` reads the disk `.md` with a lightweight frontmatter parse … This is a **SEPARATE
 * > reader** from the SDK's own `.theokit/agents` loader … so the two **can technically drift** — the
 * > drift guard in `roles-materialize.test.ts` reads the raw `.md` independently and pins the
 * > resolved whitelist against it to catch that."*
 *
 * A test that exists solely to watch a duplication is the cleanest proof the duplication should not
 * exist. With this promotion, `loadRole` and the drift test can be deleted — and that
 * deletion is the milestone's success criterion (ADR D1 of the plan).
 *
 * ## What is exported is the PARSED config, not the file format
 *
 * ROADMAP risk #2: exporting the loader may freeze an internal format as public API. That is why
 * the return is an `AgentDefinition` — the already-interpreted data — and not the `.md` text nor the shape of
 * frontmatter. The file format stays an internal detail, free to change.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { discoverSubagents } from "../src/subagents-loader.js";

const cwd = mkdtempSync(join(tmpdir(), "m81-subagents-"));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

const agentsDir = join(cwd, ".theokit", "agents");
mkdirSync(agentsDir, { recursive: true });
writeFileSync(
  join(agentsDir, "explorer.md"),
  "---\nname: explorer\ndescription: explores the repo\ntools: read_file, search_text\n---\n\nYou explore.\n",
);
writeFileSync(
  join(agentsDir, "analyst.md"),
  "---\nname: analyst\ndescription: analyzes\n---\n\nYou analyze.\n",
);

describe("M81 T2.1 — public subagents loader", () => {
  it("test_discoverSubagents_lists_the_ones_in_the_directory", async () => {
    const found = await discoverSubagents(cwd);
    expect(Object.keys(found).sort()).toEqual(["analyst", "explorer"]);
  });

  it("test_returns_the_PARSED_config_and_not_the_file_format", async () => {
    // ROADMAP risk #2. Returning the `.md` text or the frontmatter shape would freeze a format
    // internal format as public API; returning an `AgentDefinition` leaves the format free to change.
    const found = await discoverSubagents(cwd);
    const explorer = found.explorer as unknown as Record<string, unknown>;

    expect(explorer.description, "the description must come interpreted").toBe("explores the repo");
    expect(
      JSON.stringify(explorer),
      "the return must not carry the raw frontmatter text",
    ).not.toContain("---");
  });

  it("test_COUNTERPROOF_an_empty_directory_returns_an_empty_list_without_throwing", async () => {
    // A project with no subagents is the common case, not an error. Without this counter-proof, an implementation
    // throwing on `ENOENT` would pass the tests above and break every new project.
    const empty = mkdtempSync(join(tmpdir(), "m81-empty-"));
    try {
      expect(await discoverSubagents(empty)).toEqual({});
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

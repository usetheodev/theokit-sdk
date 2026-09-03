import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  pluginBundleRoots,
  projectConfigRoots,
} from "../../../../src/internal/persistence/paths.js";

import {
  adaptersForSurface,
  type CompatSurface,
} from "../../../../src/internal/runtime/compat/foreign-config-sources.js";

/**
 * usetheokit/theokit-sdk#524, the half the opt-in did not cover.
 *
 * `compatSources: ["claude-code"]` is all-or-nothing: declaring it imports hooks, plugins, skills
 * AND subagents. The four surfaces carry very different risk — a skill is text that enters the
 * system prompt, a hook is command execution — so a consumer who wants their skills back has no
 * way to ask for skills alone, and is handed arbitrary command execution with them.
 *
 * The issue specifies the shape:
 *
 *     [[compat.adapter]]
 *     kind = "claude-code"
 *     import = ["skills", "subagents"]     # explicitly NOT hooks or plugins
 *
 * ## Two decisions encoded here
 *
 * **The bare string keeps meaning every surface.** It is what `5.0.0-next.1` published and what a
 * consumer already on the prerelease wrote; silently narrowing it would turn a working opt-in into
 * a silent no-op, which is the failure class this whole issue is about.
 *
 * **An object with no `import` imports nothing.** That is the issue's own rule — "an adapter with
 * no import list should import nothing, so a typo fails closed" — and it is safe precisely because
 * the object form is new: nobody can be relying on it yet.
 */
const ALL: CompatSurface[] = ["hooks", "plugins", "skills", "subagents"];

describe("a foreign source can be admitted to some surfaces and not others", () => {
  it("the bare string still admits every surface", () => {
    for (const surface of ALL) {
      expect(adaptersForSurface(["claude-code"], surface).map((a) => a.kind)).toEqual([
        "claude-code",
      ]);
    }
  });

  it("an explicit import list admits only what it names", () => {
    const sources = [{ kind: "claude-code" as const, import: ["skills", "subagents"] as const }];

    expect(adaptersForSurface(sources, "skills").map((a) => a.kind)).toEqual(["claude-code"]);
    expect(adaptersForSurface(sources, "subagents").map((a) => a.kind)).toEqual(["claude-code"]);
    // The point of the whole exercise: reusing skills must not hand over command execution.
    expect(adaptersForSurface(sources, "hooks")).toEqual([]);
    expect(adaptersForSurface(sources, "plugins")).toEqual([]);
  });

  it("an object with no import list imports nothing", () => {
    for (const surface of ALL) {
      expect(adaptersForSurface([{ kind: "claude-code" }], surface)).toEqual([]);
    }
  });

  it("an unknown surface in the list is dropped, not turned into a root", () => {
    // Same fail-closed rule the unknown-kind case already follows.
    const sources = [{ kind: "claude-code" as const, import: ["skils"] as unknown as ["skills"] }];
    for (const surface of ALL) {
      expect(adaptersForSurface(sources, surface)).toEqual([]);
    }
  });

  it("an unknown kind is dropped whatever its import list claims", () => {
    const sources = [{ kind: "codex" as unknown as "claude-code", import: ["skills"] as const }];
    expect(adaptersForSurface(sources, "skills")).toEqual([]);
  });
});

describe("the narrow permission reaches the surfaces themselves", () => {
  /**
   * The unit above proves the resolver. This proves the WIRING — that each of the four readers asks
   * for its own surface rather than sharing one answer. A resolver nobody consults is the shape of
   * defect this repository has paid for before: correct code, never called.
   */
  it("importing only skills does not open the hooks or plugins roots", () => {
    const sources = [{ kind: "claude-code" as const, import: ["skills"] as const }];

    expect(projectConfigRoots("/w", sources, "skills")).toEqual([
      join("/w", ".theokit"),
      join("/w", ".claude"),
    ]);
    // Command execution and code loading stay behind the native root alone.
    expect(projectConfigRoots("/w", sources, "hooks")).toEqual([join("/w", ".theokit")]);
    expect(projectConfigRoots("/w", sources, "plugins")).toEqual([join("/w", ".theokit")]);
    expect(pluginBundleRoots("/w", sources)).toEqual([join("/w", ".theokit", "plugins")]);
  });

  it("importing only hooks does not open the skills root", () => {
    const sources = [{ kind: "claude-code" as const, import: ["hooks"] as const }];

    expect(projectConfigRoots("/w", sources, "hooks")).toEqual([
      join("/w", ".theokit"),
      join("/w", ".claude"),
    ]);
    expect(projectConfigRoots("/w", sources, "skills")).toEqual([join("/w", ".theokit")]);
  });

  it("the bare string still opens all four, so a 5.0.0-next.1 consumer is unaffected", () => {
    for (const surface of ALL) {
      expect(projectConfigRoots("/w", ["claude-code"], surface)).toEqual([
        join("/w", ".theokit"),
        join("/w", ".claude"),
      ]);
    }
    expect(pluginBundleRoots("/w", ["claude-code"])).toEqual([
      join("/w", ".theokit", "plugins"),
      join("/w", ".claude", "plugins"),
    ]);
  });
});

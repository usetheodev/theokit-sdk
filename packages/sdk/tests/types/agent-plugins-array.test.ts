/**
 * Type test: `AgentOptions.plugins` accepts BOTH the named-enable settings
 * form (`{ enabled: [...] }`) AND an array of code `Plugin` objects.
 *
 * The runtime (`extractCodePlugins`) and the public docs both accept a
 * `Plugin[]`, but the type historically only allowed `PluginsSettings`,
 * forcing consumers to `as unknown as PluginsSettings`-cast a real array.
 * These assertions lock the widened union so neither form regresses.
 */

import { describe, expectTypeOf, it } from "vitest";

import type { Plugin } from "../../src/index.js";
import type { AgentOptions } from "../../src/types/agent.js";
import type { PluginsSettings } from "../../src/types/providers.js";

describe("AgentOptions.plugins union (settings OR Plugin[])", () => {
  it("accepts the named-enable settings form", () => {
    expectTypeOf<PluginsSettings>().toMatchTypeOf<AgentOptions["plugins"]>();
  });

  it("accepts an array of code Plugin objects", () => {
    expectTypeOf<readonly Plugin[]>().toMatchTypeOf<AgentOptions["plugins"]>();
  });

  it("accepts a concrete array literal of plugins without a cast", () => {
    const arrayForm = { plugins: [] as Plugin[] } satisfies Pick<AgentOptions, "plugins">;
    const settingsForm = { plugins: { enabled: ["x"] } } satisfies Pick<AgentOptions, "plugins">;
    expectTypeOf(arrayForm.plugins).toMatchTypeOf<AgentOptions["plugins"]>();
    expectTypeOf(settingsForm.plugins).toMatchTypeOf<AgentOptions["plugins"]>();
  });
});

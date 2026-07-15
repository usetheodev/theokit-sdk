/**
 * PRODUCER contract test (theokit ↔ @theokit/sdk seam) — the mirror of theokit's consumer test
 * `theokit/tests/integration/contract-sdk-seam.test.ts` (M48). It asserts the SDK's OWN built
 * `dist/` still exports the surface theokit binds, so a change here that would break theokit fails
 * at PUBLISH (via `prepublishOnly`) instead of after release.
 *
 * Mirrors the theo-ui producer pattern (`theokit-ui/tests/contract/theokit-consumer.test.ts`):
 *  - `PKG_ROOT` via `fileURLToPath(import.meta.url)` (EC-1 — never `require.resolve('./dist')`).
 *  - `describe.skipIf(!distBuilt)` so the general `pnpm test` sweep (which runs before `pnpm build`)
 *    skips cleanly; `prepublishOnly` (`pnpm build && pnpm test:contract`) guarantees dist is present
 *    at the publish gate, so the contract is always enforced there.
 *
 * The consumed surface pinned here mirrors what theokit's bridge binds
 * (`@theokit/agents/src/bridge/sdk-adapter.ts`): `Agent.getOrCreate` + `Agent.registry`, `Tool.create`,
 * `SkillReadTool.create`, and the typed-error bases (`AgentRunError` / `ToolError` / `TheokitAgentError`).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

// This file: packages/sdk/tests/theokit-consumer-contract.test.ts → PKG_ROOT is one level up.
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(PKG_ROOT, "dist", "index.js");
const distBuilt = existsSync(DIST_ENTRY);

describe.skipIf(!distBuilt)(
  "Contract: @theokit/sdk dist honors the theokit consumer surface (M48)",
  () => {
    it("precondition — dist/index.js exists (run pnpm build first)", () => {
      expect(distBuilt).toBe(true);
    });

    it("exports Agent with getOrCreate + registry (theokit bridge + boot/shutdown bind these)", async () => {
      const sdk = await import(pathToFileURL(DIST_ENTRY).href);
      expect(typeof sdk.Agent).toBe("function");
      expect(typeof sdk.Agent.getOrCreate).toBe("function");
      expect(typeof sdk.Agent.registry).toBe("object");
      expect(typeof sdk.Agent.registry.configure).toBe("function");
      expect(typeof sdk.Agent.registry.evictAll).toBe("function");
    });

    it("exports Tool.create + SkillReadTool.create (theokit binds these as its tool factories)", async () => {
      const sdk = await import(pathToFileURL(DIST_ENTRY).href);
      expect(typeof sdk.Tool).toBe("function");
      expect(typeof sdk.Tool.create).toBe("function");
      expect(typeof sdk.SkillReadTool?.create).toBe("function");
    });

    it("exports the typed-error bases theokit surfaces (AgentRunError / ToolError / TheokitAgentError)", async () => {
      const sdk = await import(pathToFileURL(DIST_ENTRY).href);
      expect(typeof sdk.AgentRunError).toBe("function");
      expect(typeof sdk.ToolError).toBe("function");
      expect(typeof sdk.TheokitAgentError).toBe("function");
    });
  },
);

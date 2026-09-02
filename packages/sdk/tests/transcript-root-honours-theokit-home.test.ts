/**
 * M94 Phase 1 — the transcript root honors THEOKIT_HOME like its siblings.
 *
 * The ROADMAP says "like `catalog-source-models-dev.ts:49`". Measured: that sibling is
 * **home-anchored with an env override**. The `getTheokitHome(cwd)` in `paths.ts`
 * is **cwd-anchored** — reusing it would move the transcript of everyone who does NOT set
 * the variable, far beyond ROADMAP risk #1. See the plan's ADR-2.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultBaseDir, transcriptRoot } from "../src/internal/persistence/session-transcript.js";

const original = process.env.THEOKIT_HOME;
afterEach(() => {
  if (original === undefined) delete process.env.THEOKIT_HOME;
  else process.env.THEOKIT_HOME = original;
});

describe("M94 — transcriptRoot", () => {
  it("honors THEOKIT_HOME when it is set", () => {
    process.env.THEOKIT_HOME = "/tmp/m94-custom-root";
    expect(transcriptRoot()).toBe("/tmp/m94-custom-root");
  });

  it("ignores an empty or whitespace-only THEOKIT_HOME (same discipline as the sibling)", () => {
    process.env.THEOKIT_HOME = "   ";
    expect(transcriptRoot()).toBe(join(homedir(), ".theokit"));
  });

  it("falls back to ~/.theokit — NOT to <cwd>/.theokit (ADR-2)", () => {
    delete process.env.THEOKIT_HOME;
    expect(transcriptRoot()).toBe(join(homedir(), ".theokit"));
    expect(transcriptRoot()).not.toBe(join(process.cwd(), ".theokit"));
  });

  it("defaultBaseDir delegates — an inlined homedir() fails here", () => {
    process.env.THEOKIT_HOME = "/tmp/m94-delegates";
    expect(defaultBaseDir()).toBe("/tmp/m94-delegates");
  });
});

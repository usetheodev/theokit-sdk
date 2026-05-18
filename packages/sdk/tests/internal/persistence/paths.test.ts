/**
 * RED tests for T0.1 — `getTheokitHome`, `getProfilesRoot`, `displayTheokitHome`.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  displayTheokitHome,
  getProfilesRoot,
  getTheokitHome,
} from "../../../src/internal/persistence/paths.js";

describe("getTheokitHome", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.THEOKIT_HOME;
    delete process.env.THEOKIT_HOME;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.THEOKIT_HOME;
    else process.env.THEOKIT_HOME = originalEnv;
  });

  it("returns cwd default when env unset", () => {
    expect(getTheokitHome("/work/repo")).toBe(join("/work/repo", ".theokit"));
  });

  it("returns env value when THEOKIT_HOME set", () => {
    process.env.THEOKIT_HOME = "/tmp/xyz";
    expect(getTheokitHome("/work/repo")).toBe("/tmp/xyz");
  });

  it("treats empty string env as unset", () => {
    process.env.THEOKIT_HOME = "";
    expect(getTheokitHome("/work/repo")).toBe(join("/work/repo", ".theokit"));
  });

  it("treats whitespace-only env as unset", () => {
    process.env.THEOKIT_HOME = "   ";
    expect(getTheokitHome("/work/repo")).toBe(join("/work/repo", ".theokit"));
  });

  it("is idempotent — same input yields same output", () => {
    process.env.THEOKIT_HOME = "/tmp/state";
    const first = getTheokitHome("/work");
    const second = getTheokitHome("/work");
    expect(first).toBe(second);
  });
});

describe("getProfilesRoot", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.THEOKIT_HOME;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.THEOKIT_HOME;
    else process.env.THEOKIT_HOME = originalEnv;
  });

  it("returns ~/.theokit/profiles regardless of THEOKIT_HOME", () => {
    process.env.THEOKIT_HOME = "/tmp/some-override";
    expect(getProfilesRoot()).toBe(join(homedir(), ".theokit", "profiles"));
  });

  it("returns ~/.theokit/profiles when THEOKIT_HOME unset", () => {
    delete process.env.THEOKIT_HOME;
    expect(getProfilesRoot()).toBe(join(homedir(), ".theokit", "profiles"));
  });
});

describe("displayTheokitHome", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.THEOKIT_HOME;
    delete process.env.THEOKIT_HOME;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.THEOKIT_HOME;
    else process.env.THEOKIT_HOME = originalEnv;
  });

  it("collapses $HOME to ~ when path is under home", () => {
    process.env.THEOKIT_HOME = join(homedir(), "state", ".theokit");
    expect(displayTheokitHome("/ignored")).toBe("~/state/.theokit");
  });

  it("returns ~ alone when path equals home", () => {
    process.env.THEOKIT_HOME = homedir();
    expect(displayTheokitHome("/ignored")).toBe("~");
  });

  it("returns absolute path unchanged when not under home", () => {
    process.env.THEOKIT_HOME = "/var/lib/theokit";
    expect(displayTheokitHome("/ignored")).toBe("/var/lib/theokit");
  });
});

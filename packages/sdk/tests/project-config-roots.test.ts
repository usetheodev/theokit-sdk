import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectConfigRoots } from "../src/internal/persistence/paths.js";

/*
 * Where a project's configuration is read from.
 *
 * `.theokit` is this SDK's own namespace and stays first: a project that declares both means the
 * explicit one to win. `.claude` is read too, so a repository already set up for the Claude Code
 * CLI works here without being converted — its skills, agents, hooks and rules are the same
 * formats, they were simply in a directory nothing looked at.
 */
describe("projectConfigRoots", () => {
  const saved = process.env.THEOKIT_HOME;
  afterEach(() => {
    if (saved === undefined) delete process.env.THEOKIT_HOME;
    else process.env.THEOKIT_HOME = saved;
  });

  it("test_both_directories_are_searched", () => {
    expect(projectConfigRoots("/work")).toEqual([
      join("/work", ".theokit"),
      join("/work", ".claude"),
    ]);
  });

  it("test_the_explicit_namespace_is_searched_first_so_it_wins_a_collision", () => {
    expect(projectConfigRoots("/work")[0]).toBe(join("/work", ".theokit"));
  });

  // THEOKIT_HOME relocates cwd-anchored SDK STATE (sessions, credentials). A project's
  // CONFIGURATION belongs to the repository, and the loaders reading these directories have always
  // anchored on cwd directly — following the override here would move where a project's agents come
  // from, which is a behaviour change wearing the costume of a refactor.
  it("test_the_theokit_home_override_does_not_move_project_configuration", () => {
    process.env.THEOKIT_HOME = "/elsewhere";
    expect(projectConfigRoots("/work")).toEqual([
      join("/work", ".theokit"),
      join("/work", ".claude"),
    ]);
  });
});

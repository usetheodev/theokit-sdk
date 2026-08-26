import { describe, expect, it } from "vitest";
import { importableSubpaths, specifierFor } from "../check-published-imports.mjs";

describe("importableSubpaths", () => {
  it("test_every_subpath_with_an_import_condition_is_probed", () => {
    expect(
      importableSubpaths({
        ".": { import: { default: "./dist/index.js" } },
        "./a2a": { import: { default: "./dist/a2a.js" } },
      }),
    ).toEqual([".", "./a2a"]);
  });

  // The accepted case above is half the oracle (rules/testing.md § 4.2): without it, a filter that
  // returned nothing would pass every rejection assertion below and the gate would probe zero
  // subpaths while reporting PASS — the exact shape of a green that proves nothing.
  it("test_the_package_json_subpath_is_not_probed_because_json_proves_no_code_loads", () => {
    expect(importableSubpaths({ "./package.json": "./package.json" })).toEqual([]);
  });

  it("test_a_wildcard_subpath_is_not_probed_because_it_names_no_concrete_module", () => {
    expect(importableSubpaths({ "./*": { import: { default: "./dist/*.js" } } })).toEqual([]);
  });

  it("test_a_require_only_subpath_is_not_probed_by_an_esm_import", () => {
    expect(importableSubpaths({ "./cjs": { require: { default: "./dist/cjs.cjs" } } })).toEqual([]);
  });

  it("test_a_package_with_no_exports_map_yields_nothing_rather_than_throwing", () => {
    expect(importableSubpaths(undefined)).toEqual([]);
  });
});

describe("specifierFor", () => {
  it("test_the_root_subpath_is_the_bare_package_name", () => {
    expect(specifierFor("@theokit/sdk", ".")).toBe("@theokit/sdk");
  });

  it("test_a_nested_subpath_is_appended_without_the_leading_dot", () => {
    expect(specifierFor("@theokit/sdk", "./a2a")).toBe("@theokit/sdk/a2a");
  });
});

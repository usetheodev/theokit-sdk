import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import * as sdk from "../src/index.js";

/**
 * B-153. `defineProvider` carried a full `@public` docblock — with a worked example telling
 * callers to write `defineProvider({...})` and hand the result to `Agent.create` — and no
 * `export`. Following the documentation produced `TypeError: defineProvider is not a function`.
 *
 * The capability was never missing: `Provider.create` is the exported façade and delegates to it.
 * Only the documented door did not exist.
 *
 * `quality:doc-api` did not catch this because it verifies imports that appear in doc FILES, and
 * this example lives in a source docblock. These two assertions close that specific gap.
 */

it("exports the entry point its own docblock tells callers to use", () => {
  // The symbol named in the example must be reachable from the package's public surface.
  expect(sdk.Provider).toBeTypeOf("function");
  expect(sdk.Provider.create).toBeTypeOf("function");
});

it("does not advertise an entry point that is not exported", () => {
  const source = readFileSync(
    join(import.meta.dirname, "..", "src", "define-provider.ts"),
    "utf-8",
  );
  const docblock = source.slice(0, source.indexOf("function defineProvider"));

  // Every `X(` call shown inside the docblock's example must resolve on the public surface.
  // The old text showed `defineProvider({`, which does not — and that is the whole defect.
  expect(docblock).not.toContain("const groq = defineProvider(");
  expect(docblock).toContain("const groq = Provider.create(");
});

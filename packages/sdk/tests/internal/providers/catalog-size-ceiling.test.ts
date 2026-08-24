import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { refreshModelCatalog } from "../../../src/internal/providers/catalog-source-models-dev.js";

/**
 * CodeQL `js/http-to-file-access` #26. Writing a fetched catalog to a cache file is what this
 * module is FOR, and the cache path comes from a SHA-256 of the URL rather than from anything a
 * server controls — so the alert's literal shape is the design.
 *
 * The real exposure the alert points at is the missing bound: the body was read with `res.text()`
 * and persisted with no ceiling. `THEOKIT_MODELS_URL` lets an operator point this anywhere, and a
 * host serving a multi-gigabyte document would have been materialised in memory and written to
 * disk.
 */

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "catalog-ceiling-"));
  previousHome = process.env.THEOKIT_HOME;
  process.env.THEOKIT_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.THEOKIT_HOME;
  else process.env.THEOKIT_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

const OVER_CEILING = 33 * 1024 * 1024;

/** A response whose declared and actual sizes can disagree, which is the interesting case. */
function respondWith(body: string, declaredLength?: number): typeof fetch {
  return (async () =>
    new Response(body, {
      status: 200,
      headers: declaredLength === undefined ? {} : { "content-length": String(declaredLength) },
    })) as unknown as typeof fetch;
}

it("refuses a catalog that declares a size over the ceiling, without reading it", async () => {
  // Declared huge, body tiny: only the header check can catch this, and catching it is the
  // point — the ceiling exists so an oversized body is never materialised at all.
  const result = await refreshModelCatalog({
    url: "https://example.invalid/huge.json",
    force: true,
    deps: { fetch: respondWith("{}", OVER_CEILING) },
  });

  // Fail-closed: the module never throws on a refresh failure, it serves what it had.
  expect(result.source).toBe("cache");
});

it("refuses a catalog that lies about its size and arrives oversized anyway", async () => {
  // No content-length at all. A server that omits the header is exactly the one worth bounding,
  // so the post-read check is not redundant with the header check.
  const oversized = `{"x":"${"y".repeat(OVER_CEILING)}"}`;

  const result = await refreshModelCatalog({
    url: "https://example.invalid/lying.json",
    force: true,
    deps: { fetch: respondWith(oversized) },
  });

  expect(result.source).toBe("cache");
});

it("still accepts a catalog under the ceiling", async () => {
  // The accepted case (`testing.md` § 4.2). A ceiling that refused everything would pass both
  // tests above and silently stop the SDK ever refreshing its model catalog.
  const result = await refreshModelCatalog({
    url: "https://example.invalid/fine.json",
    force: true,
    deps: { fetch: respondWith(JSON.stringify({ openai: { models: {} } })) },
  });

  expect(result.source).toBe("network");
});

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Cache } from "../src/cache.js";

/*
 * #359 — `persistence: { backend: "json" }` is sold as surviving restarts, and for the CLI-shaped
 * process it is aimed at it often did neither.
 *
 *  1. Hydration was fire-and-forget and the documented way to wait — `await cache.ready()` — did
 *     not exist, so a lookup issued right after construction raced the `readFile` and missed on an
 *     entry that was on disk.
 *  2. Writes are debounced 200ms and `flush()` lived on a store that is neither exported nor
 *     reachable from `Cache`. A process that remembered something and exited inside 200ms wrote
 *     nothing — precisely the "CLI that runs once per invocation" the docblock names as the reason
 *     to pick this backend.
 *  3. Two `Cache` instances on one `(dir, namespace)` each owned a private store and wrote their
 *     own full snapshot, so the last flush silently erased the other's entries.
 */

const embedder = {
  id: "fake",
  model: "fake-1",
  dimension: 4,
  embed: async (texts: ReadonlyArray<string>) => texts.map(() => [0.1, 0.2, 0.3, 0.4]),
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cache-json-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const semantic = (namespace = "ns"): Cache =>
  Cache.semantic({ embedder, namespace, persistence: { backend: "json", dir } });

it("a lookup right after construction sees what is already on disk", async () => {
  await (async () => {
    const writer = semantic();
    await writer.remember("what is our refund window?", "30 days");
    await writer.flush();
  })();

  // A fresh process would do exactly this: construct, then immediately ask.
  const reader = semantic();
  await reader.ready();
  const hit = await reader.consult("what is our refund window?");

  expect(hit.hit).toBe(true);
  expect(hit.hit === true ? hit.response : undefined).toBe("30 days");
});

it("flush() writes the debounced snapshot without destroying it", async () => {
  const cache = semantic();
  await cache.remember("p", "r");

  await cache.flush();

  // No 200ms wait, and — unlike `clear()`, which was the only public call that flushed — the
  // entries are still there.
  const snapshot = readFileSync(join(dir, "ns.json"), "utf8");
  expect(snapshot).toContain("p");
  expect((await cache.stats()).entries).toBe(1);
});

it("two caches on one file do not erase each other", async () => {
  const a = semantic();
  const b = semantic();

  await a.remember("from-a", "ra");
  await b.remember("from-b", "rb");
  await a.flush();
  await b.flush();

  const snapshot = readFileSync(join(dir, "ns.json"), "utf8");
  expect(snapshot).toContain("from-a");
  expect(snapshot).toContain("from-b");
});

it("different namespaces stay isolated, and flush on an in-memory cache is a no-op", async () => {
  // The accepted cases (`testing.md` § 4.2). Sharing keyed too broadly would merge namespaces that
  // are documented never to match, and `flush`/`ready` must be safe to call on any cache.
  const one = semantic("alpha");
  const two = semantic("beta");
  await one.remember("only-in-alpha", "r");
  await one.flush();
  await two.flush();

  expect(readFileSync(join(dir, "alpha.json"), "utf8")).toContain("only-in-alpha");
  expect(() => readFileSync(join(dir, "beta.json"), "utf8")).toThrow();

  const memory = Cache.semantic({ embedder });
  await memory.ready();
  await expect(memory.flush()).resolves.toBeUndefined();
});

it("hydration ignores a corrupt snapshot instead of taking the process down", async () => {
  writeFileSync(join(dir, "ns.json"), "{ not json");

  const cache = semantic();
  await expect(cache.ready()).resolves.toBeUndefined();
  expect((await cache.stats()).entries).toBe(0);
});

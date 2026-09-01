/**
 * No exported error class may extend bare `Error`.
 *
 * `src/errors.ts` ships a typed hierarchy whose root carries `isRetryable`, `code`, `protoErrorCode`
 * and `metadata`, and the README tells consumers to catch `TheokitAgentError`. Twenty-four exported
 * `*Error` classes did not extend it, so a consumer following the documented pattern silently missed
 * them and none of them carried a retryability answer.
 *
 * They were found by accident — one migrated test assertion failed inside `expectPublicError`, whose
 * premise is that a public typed error IS a `TheokitAgentError`. Twenty-four classes had accumulated
 * over the life of the package because nothing asked. This asks.
 *
 * The rule is deliberately about the DECLARATION, not about behaviour: it cannot tell whether
 * `isRetryable` was chosen well, only that the class joined the hierarchy where that question has to
 * be answered. That is the part a script can check, and stating the limit is the point.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { expectScopeCovered } from "./_scope-sentinel.js";

const SRC_ROOT = join(__dirname, "..", "..", "src");

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const { readdir, stat } = await import("node:fs/promises");
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) await walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** `export class SomethingError extends Error` — the exact declaration this forbids. */
const BARE = /export class (\w*Error) extends Error\b/g;

/** The root itself is the one class that must extend Error. */
function bareErrorClassesIn(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(BARE)]
    .map((m) => m[1] ?? "")
    .filter((name) => name.length > 0 && name !== "TheokitAgentError")
    .map((name) => `${relative(SRC_ROOT, file)}: ${name}`);
}

describe("every exported error joins the SDK hierarchy", () => {
  it("no exported *Error extends bare Error", async () => {
    const files = await walk(SRC_ROOT);
    expectScopeCovered(files, "errors.ts", SRC_ROOT);
    const offenders = files.flatMap(bareErrorClassesIn);

    expect(
      offenders,
      offenders.length === 0
        ? ""
        : `These classes extend bare Error, so a consumer doing the documented ` +
            `\`catch (e) { if (e instanceof TheokitAgentError) }\` misses them, and none of them ` +
            `carries isRetryable:\n${offenders.map((o) => `  ${o}`).join("\n")}\n` +
            `Extend TheokitAgentError, pass a \`code\`, and make an explicit isRetryable decision — ` +
            `it is additive, \`instanceof Error\` still holds.`,
    ).toEqual([]);
  });
});
